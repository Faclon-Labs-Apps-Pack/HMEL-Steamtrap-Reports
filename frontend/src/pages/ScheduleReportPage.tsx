import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table,
  TableBody,
  TableHeader,
  TableHeaderRow,
  TableHeaderCell,
  TableRow,
  TableCell,
  TableToolbar,
  CellText,
} from '@faclon-labs/design-sdk/Table';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { Badge } from '@faclon-labs/design-sdk';
import { Button } from '@faclon-labs/design-sdk/Button';
import {
  fetchSchedules,
  pauseAll,
  resumeAll,
  pauseSection,
  resumeSection,
  saveRecipients,
  validateOverrides,
  saveOverrides,
  overridesExportUrl,
  type Schedule,
  type SchedulesResponse,
  type OverridesValidation,
} from '../services/adminApi';

interface ScheduleRow extends Schedule {
  id: string;
  [key: string]: unknown;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

const LAST_RUN_COLOR: Record<string, 'Positive' | 'Negative' | 'Notice' | 'Neutral'> = {
  sent: 'Positive',
  failed: 'Negative',
  'generation-failed': 'Negative',
  skipped: 'Notice',
};

/** Inline editor for one section's recipient list (comma/newline separated). */
function RecipientsEditor({
  row,
  onSaved,
  onCancel,
}: {
  row: ScheduleRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(row.recipients.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(recipients: string[] | null) {
    setSaving(true);
    setError(null);
    try {
      await saveRecipients(row.key, row.type, recipients);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setSaving(false);
    }
  }

  return (
    <div className="ui-fade-in" style={{ padding: 'var(--spacing-04)', border: '1px solid var(--border-neutral-default, #ddd)', borderRadius: 8, margin: 'var(--spacing-03) 0', background: 'var(--surface-neutral-lightest, #fafafa)' }}>
      <p className="BodyMediumSemibold" style={{ marginTop: 0 }}>
        Edit recipients — {row.name} ({row.type})
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{ width: '100%', font: 'inherit', padding: 8, border: '1px solid var(--border-neutral-default, #ccc)', borderRadius: 6, boxSizing: 'border-box' }}
        placeholder="a@hmel.in, b@hmel.in"
      />
      <p className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #666)' }}>
        Comma or newline separated. Saved to the overrides file — applies from the NEXT scheduled
        run, no restart. "Revert to .env" removes the override so the .env list applies again.
      </p>
      {error && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 'var(--spacing-03)' }}>
        <Button
          variant="Primary"
          isLoading={saving}
          label="Save"
          onClick={() => void save(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))}
        />
        {row.recipientsOverridden && (
          <Button variant="Secondary" label="Revert to .env list" onClick={() => void save(null)} />
        )}
        <Button variant="Gray" label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );
}

/** Upload flow: pick file -> dry-run validation preview -> apply. */
function ImportOverrides({ onApplied }: { onApplied: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ text: string; preview: OverridesValidation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const preview = await validateOverrides(text);
      setPending({ text, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read/validate the file.');
    }
  }

  async function apply() {
    if (!pending) return;
    setApplying(true);
    setError(null);
    try {
      await saveOverrides(pending.text);
      setPending(null);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      <Button variant="Secondary" label="Import overrides (.txt)" onClick={() => fileRef.current?.click()} />
      {error && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{error}</p>}
      {pending && (
        <div className="ui-fade-in" style={{ marginTop: 'var(--spacing-03)', padding: 'var(--spacing-04)', border: '1px solid var(--border-neutral-default, #ddd)', borderRadius: 8 }}>
          <p className="BodyMediumSemibold" style={{ marginTop: 0 }}>Preview — what this file will do</p>
          <ul className="BodySmallRegular" style={{ paddingLeft: 'var(--spacing-05)' }}>
            <li>Pause ALL reports: <strong>{pending.preview.pauseAll ? 'YES' : 'no'}</strong></li>
            <li>Paused sections: {pending.preview.pausedKeys.length > 0 ? pending.preview.pausedKeys.join(', ') : 'none'}</li>
            <li>
              Recipient overrides:{' '}
              {Object.keys(pending.preview.recipients).length > 0
                ? Object.entries(pending.preview.recipients).map(([k, v]) => `${k} (${v.length})`).join('; ')
                : 'none'}
            </li>
          </ul>
          {pending.preview.errors.length > 0 && (
            <div className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>
              <p style={{ marginBottom: 4 }}>These lines are invalid and will be IGNORED (reports fall back to .env for them):</p>
              <ul style={{ marginTop: 0, paddingLeft: 'var(--spacing-05)' }}>
                {pending.preview.errors.map((e) => (
                  <li key={e.line}>line {e.line}: “{e.text}” — {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--spacing-03)' }}>
            <Button variant="Primary" isLoading={applying} label="Apply" onClick={() => void apply()} />
            <Button variant="Gray" label="Cancel" onClick={() => setPending(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ScheduleReportPage() {
  const [data, setData] = useState<SchedulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchSchedules());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePause(row: ScheduleRow) {
    setBusyKey(row.key);
    try {
      if (row.paused) await resumeSection(row.key);
      else await pauseSection(row.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function togglePauseAll() {
    if (!data) return;
    setBusyKey('__all__');
    try {
      if (data.pauseAll) await resumeAll();
      else await pauseAll();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusyKey(null);
    }
  }

  const rows: ScheduleRow[] = (data?.schedules ?? []).map((s) => ({ ...s, id: `${s.type}-${s.key}` }));
  const editingRow = rows.find((r) => r.id === editingKey) ?? null;

  return (
    <div className="global-p-06">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-04)', flexWrap: 'wrap', marginBottom: 'var(--spacing-04)' }}>
        <h1 className="HeadingSmallSemibold" style={{ margin: 0, flex: 1 }}>Scheduled Reports</h1>
        <a href={overridesExportUrl} download className="BodySmallRegular">Export overrides (.txt)</a>
        <ImportOverrides onApplied={() => void load()} />
        {data && (
          <Button
            variant={data.pauseAll ? 'Primary' : 'Secondary'}
            isLoading={busyKey === '__all__'}
            label={data.pauseAll ? 'RESUME ALL reports' : 'Pause ALL reports'}
            onClick={() => void togglePauseAll()}
          />
        )}
      </div>

      <p className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #666)', marginTop: 0 }}>
        Changes here go to the runtime overrides file (never .env) and are picked up at the next
        scheduled run — the running scheduler is never restarted. Send times come from .env and are
        read-only here.
      </p>

      {data?.pauseAll && (
        <p className="BodyMediumSemibold" style={{ color: 'var(--text-error-default)' }}>
          ⚠ ALL scheduled reports are currently PAUSED.
        </p>
      )}
      {data && data.overrideErrors.length > 0 && (
        <div className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>
          <p style={{ marginBottom: 4 }}>Invalid lines in the overrides file (ignored by the scheduler):</p>
          <ul style={{ marginTop: 0, paddingLeft: 'var(--spacing-05)' }}>
            {data.overrideErrors.map((e) => (
              <li key={e.line}>line {e.line}: “{e.text}” — {e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-08)' }}>
          <Spinner label="Loading…" />
        </div>
      )}
      {error && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{error}</p>}

      {editingRow && (
        <RecipientsEditor
          row={editingRow}
          onCancel={() => setEditingKey(null)}
          onSaved={() => {
            setEditingKey(null);
            void load();
          }}
        />
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <Table
            data={{ nodes: rows }}
            toolbar={<TableToolbar title="Sections" subtitle={`${rows.length} scheduled reports`} />}
          >
            {(visibleRows: ScheduleRow[]) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Send time (IST)</TableHeaderCell>
                    <TableHeaderCell>State</TableHeaderCell>
                    <TableHeaderCell>Recipients</TableHeaderCell>
                    <TableHeaderCell>Last run</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell contentType="text"><CellText title={row.name} /></TableCell>
                      <TableCell contentType="text"><CellText title={row.type} /></TableCell>
                      <TableCell contentType="text"><CellText title={row.sendTime} /></TableCell>
                      <TableCell contentType="text">
                        <Badge
                          size="Small"
                          color={row.paused || data?.pauseAll ? 'Negative' : 'Positive'}
                          label={data?.pauseAll ? 'paused (ALL)' : row.paused ? 'paused' : 'active'}
                        />
                      </TableCell>
                      <TableCell contentType="text">
                        <div>
                          <CellText title={`${row.recipients.length} recipient(s)${row.recipientsOverridden ? ' (overridden)' : ''}`} />
                          <div className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #666)', maxWidth: 340, whiteSpace: 'normal' }}>
                            {row.recipients.join(', ')}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell contentType="text">
                        {row.lastRun ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Badge size="Small" color={LAST_RUN_COLOR[row.lastRun.status] ?? 'Neutral'} label={row.lastRun.status} />
                            <div>
                              <CellText title={formatTime(row.lastRun.time)} />
                              {row.lastRun.error && (
                                <div className="BodySmallRegular" style={{ color: 'var(--text-error-default)', maxWidth: 280, whiteSpace: 'normal' }}>
                                  {row.lastRun.error}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <CellText title="—" />
                        )}
                      </TableCell>
                      <TableCell contentType="text">
                        <div style={{ display: 'flex', gap: 'var(--spacing-02)' }}>
                          <Button
                            variant="Secondary"
                            isLoading={busyKey === row.key}
                            label={row.paused ? 'Resume' : 'Pause'}
                            onClick={() => void togglePause(row)}
                          />
                          <Button variant="Gray" label="Edit recipients" onClick={() => setEditingKey(row.id)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}
