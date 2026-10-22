import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table,
  TableBody,
  TableHeader,
  TableHeaderRow,
  TableHeaderCell,
  TableRow,
  TableCell,
  CellText,
} from '@faclon-labs/design-sdk/Table';
import { Badge } from '@faclon-labs/design-sdk';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { Upload } from 'lucide-react';
import {
  fetchSchedules,
  pauseAll,
  resumeAll,
  pauseSection,
  resumeSection,
  saveRecipients,
  saveCc,
  validateOverrides,
  saveOverrides,
  downloadOverridesExport,
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

/**
 * Recipient editor in a modal (per redesign 2026-10-19 — no more large inline form above the
 * table). Bulk paste stays supported: comma or newline separated. Saves to the overrides file;
 * changes apply from the NEXT scheduled run (fire-time read — confirmed backend behavior).
 */
function RecipientsModal({
  row,
  onSaved,
  onClose,
}: {
  row: ScheduleRow;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(row.recipients.join('\n'));
  const [ccText, setCcText] = useState((row.cc ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDaily = row.type === 'daily'; // CC applies to daily reports only

  const parsed = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const parsedCc = ccText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const duplicates = [...new Set(parsed.filter((e, i) => parsed.findIndex((x) => x.toLowerCase() === e.toLowerCase()) !== i))];

  /** Saves To and (for daily) CC together. */
  async function save(recipients: string[], cc: string[]) {
    setSaving(true);
    setError(null);
    try {
      await saveRecipients(row.key, row.type, recipients);
      if (isDaily) await saveCc(row.key, row.type, cc);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save changes.');
      setSaving(false);
    }
  }

  /** Reverts To and/or CC back to the .env defaults (null = revert). */
  async function revert(which: 'recipients' | 'cc') {
    setSaving(true);
    setError(null);
    try {
      if (which === 'recipients') await saveRecipients(row.key, row.type, null);
      else await saveCc(row.key, row.type, null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revert.');
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      size="Medium"
      onClose={onClose}
      header={
        <ModalHeader
          title={`Edit recipients — ${row.name}`}
          subtitle={`${row.type === 'daily' ? 'Daily' : 'Weekly'} report · ${row.recipients.length} To${isDaily ? ` · ${parsedCc.length} Cc` : ''}${row.recipientsOverridden ? ' · To overridden' : ''}`}
          onClose={onClose}
        />
      }
      footer={
        <ModalFooter
          primaryAction={
            <Button
              variant="Primary"
              isLoading={saving}
              isDisabled={parsed.length === 0}
              label={isDaily ? `Save ${parsed.length} To · ${parsedCc.length} Cc` : `Save ${parsed.length} recipient${parsed.length === 1 ? '' : 's'}`}
              onClick={() => void save(parsed, parsedCc)}
            />
          }
          secondaryAction={<Button variant="Secondary" label="Cancel" onClick={onClose} />}
        />
      }
    >
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="ui-field-label" htmlFor="rcpt-edit">To — one per line, or comma separated</label>
            <textarea
              id="rcpt-edit"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(12, Math.max(4, parsed.length + 1))}
              style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: 10, border: '1px solid var(--ui-border)', borderRadius: 7, boxSizing: 'border-box' }}
              placeholder={'a@hmel.in\nb@hmel.in'}
            />
            {row.recipientsOverridden && (
              <div style={{ marginTop: 6 }}>
                <Button variant="Gray" size="XSmall" label="Revert To to .env" onClick={() => void revert('recipients')} />
              </div>
            )}
          </div>
          {isDaily && (
            <div>
              <label className="ui-field-label" htmlFor="cc-edit">Cc — copied on this report (one per line, or comma separated)</label>
              <textarea
                id="cc-edit"
                value={ccText}
                onChange={(e) => setCcText(e.target.value)}
                rows={Math.min(10, Math.max(3, parsedCc.length + 1))}
                style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: 10, border: '1px solid var(--ui-border)', borderRadius: 7, boxSizing: 'border-box' }}
                placeholder={'manager@hmel.in'}
              />
              <p className="BodySmallRegular ui-muted" style={{ margin: '6px 0 0' }}>
                Common managers typically go here so they're copied on every unit rather than listed as a To.
                Leave blank for no Cc. Anyone also in To is kept as To only.
              </p>
              {row.ccOverridden && (
                <div style={{ marginTop: 6 }}>
                  <Button variant="Gray" size="XSmall" label="Revert Cc to .env" onClick={() => void revert('cc')} />
                </div>
              )}
            </div>
          )}
          {duplicates.length > 0 && (
            <p className="BodySmallRegular" style={{ color: 'var(--ui-amber)', margin: 0 }}>
              Duplicate entries: {duplicates.join(', ')} — only one copy will be kept by the mail system.
            </p>
          )}
          <p className="BodySmallRegular ui-muted" style={{ margin: 0 }}>
            Changes are saved to the runtime overrides file (never .env) and take effect from the
            next scheduled run — no restart needed.
          </p>
          {error && <p className="BodySmallRegular" style={{ color: 'var(--ui-red)', margin: 0 }}>{error}</p>}
        </div>
      </ModalBody>
    </Modal>
  );
}

/** Confirmation for the one action that can silence every report. */
function PauseAllModal({
  pauseAllActive,
  onConfirm,
  onClose,
  busy,
}: {
  pauseAllActive: boolean;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal
      isOpen
      size="Small"
      onClose={onClose}
      header={
        <ModalHeader
          title={pauseAllActive ? 'Resume all reports?' : 'Pause all reports?'}
          onClose={onClose}
        />
      }
      footer={
        <ModalFooter
          primaryAction={
            <Button
              variant="Primary"
              color={pauseAllActive ? 'Primary' : 'Negative'}
              isLoading={busy}
              label={pauseAllActive ? 'Resume all' : 'Pause all'}
              onClick={onConfirm}
            />
          }
          secondaryAction={<Button variant="Secondary" label="Cancel" onClick={onClose} />}
        />
      }
    >
      <ModalBody>
        <p className="BodySmallRegular" style={{ margin: 0 }}>
          {pauseAllActive
            ? 'Every section resumes its normal schedule from the next run. Sections paused individually stay paused.'
            : 'No scheduled report will be emailed to anyone — every section is skipped at its send time until you resume. The schedules themselves keep running and log each skipped send.'}
        </p>
      </ModalBody>
    </Modal>
  );
}

/**
 * Guided override import: upload (drag-drop or browse) → server-side dry-run validation →
 * review what would change → apply. Nothing is written until Apply, and invalid lines are
 * ignored by the scheduler even if applied (fail-open backend behavior).
 */
function ImportModal({ onApplied, onClose }: { onApplied: () => void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [pending, setPending] = useState<{ text: string; preview: OverridesValidation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setPending(null);
    try {
      const text = await file.text();
      const preview = await validateOverrides(text);
      setFileName(file.name);
      setFileSize(file.size);
      setPending({ text, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File validation failed.');
    }
  }

  async function apply() {
    if (!pending) return;
    setApplying(true);
    setError(null);
    try {
      await saveOverrides(pending.text);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply the overrides.');
      setApplying(false);
    }
  }

  const validCount = pending
    ? (pending.preview.pauseAll ? 1 : 0) +
      pending.preview.pausedKeys.length +
      Object.keys(pending.preview.recipients).length +
      Object.keys(pending.preview.cc ?? {}).length
    : 0;

  return (
    <Modal
      isOpen
      size="Medium"
      onClose={onClose}
      header={
        <ModalHeader
          title="Import schedule overrides"
          subtitle="Upload an overrides file to review changes before they are applied."
          onClose={onClose}
        />
      }
      footer={
        <ModalFooter
          primaryAction={
            <Button
              variant="Primary"
              isLoading={applying}
              isDisabled={!pending}
              label={pending ? `Apply ${validCount} change${validCount === 1 ? '' : 's'}` : 'Apply'}
              onClick={() => void apply()}
            />
          }
          secondaryAction={<Button variant="Secondary" label="Cancel" onClick={onClose} />}
        />
      }
    >
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="BodySmallRegular ui-muted" style={{ margin: 0 }}>
            Start from the current configuration:{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void downloadOverridesExport().catch(() => {});
              }}
            >
              export overrides (.txt)
            </a>
            , edit it in any text editor, then upload it here.
          </p>

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
          <div
            className={`ui-dropzone${dragOver ? ' is-over' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Upload overrides file"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          >
            <Upload size={18} aria-hidden />
            {fileName ? (
              <span>
                <strong>{fileName}</strong> ({(fileSize / 1024).toFixed(1)} KB) — click to replace
              </span>
            ) : (
              <span>Drop your file here, or <span style={{ color: 'var(--ui-blue)' }}>browse files</span> (.txt)</span>
            )}
          </div>

          {error && (
            <div className="ui-alert is-red" style={{ margin: 0 }}>
              <strong>File validation failed.</strong> {error}
            </div>
          )}

          {pending && (
            <div className="ui-fade-in">
              <div className="ui-val-row">
                <div className={`ui-val${validCount > 0 ? ' is-green' : ''}`}>
                  <b>{validCount}</b>Valid changes
                </div>
                <div className={`ui-val${pending.preview.errors.length > 0 ? ' is-red' : ''}`}>
                  <b>{pending.preview.errors.length}</b>Invalid lines
                </div>
              </div>

              <div className="BodySmallRegular" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <span className="ui-muted">Pause ALL reports: </span>
                  <strong style={{ color: pending.preview.pauseAll ? 'var(--ui-red)' : undefined }}>
                    {pending.preview.pauseAll ? 'YES' : 'no'}
                  </strong>
                </div>
                <div>
                  <span className="ui-muted">Paused sections: </span>
                  {pending.preview.pausedKeys.length > 0 ? pending.preview.pausedKeys.join(', ') : 'none'}
                </div>
                <div>
                  <span className="ui-muted">Recipient overrides: </span>
                  {Object.keys(pending.preview.recipients).length > 0
                    ? Object.entries(pending.preview.recipients).map(([k, v]) => `${k} (${v.length})`).join('; ')
                    : 'none'}
                </div>
                <div>
                  <span className="ui-muted">CC overrides: </span>
                  {Object.keys(pending.preview.cc ?? {}).length > 0
                    ? Object.entries(pending.preview.cc ?? {}).map(([k, v]) => `${k} (${v.length})`).join('; ')
                    : 'none'}
                </div>
              </div>

              {pending.preview.errors.length > 0 && (
                <div className="ui-alert is-amber" style={{ margin: '10px 0 0' }}>
                  These lines are invalid and will be IGNORED (reports fall back to .env for them):
                  <ul>
                    {pending.preview.errors.map((e) => (
                      <li key={e.line}>line {e.line}: “{e.text}” — {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

export function ScheduleReportPage() {
  const [data, setData] = useState<SchedulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showPauseAll, setShowPauseAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  /** Transient inline confirmation after an operational change. */
  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  }

  async function togglePause(row: ScheduleRow) {
    setBusyKey(row.key);
    try {
      if (row.paused) await resumeSection(row.key);
      else await pauseSection(row.key);
      await load();
      flash(`${row.name} ${row.paused ? 'resumed' : 'paused'} — applies from its next scheduled run.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmPauseAll() {
    if (!data) return;
    setBusyKey('__all__');
    try {
      if (data.pauseAll) await resumeAll();
      else await pauseAll();
      await load();
      setShowPauseAll(false);
      flash(data.pauseAll ? 'All reports resumed.' : 'All reports paused — scheduled sends will be skipped until resumed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusyKey(null);
    }
  }

  const rows: ScheduleRow[] = (data?.schedules ?? []).map((s) => ({ ...s, id: `${s.type}-${s.key}` }));
  const editingRow = rows.find((r) => r.id === editingKey) ?? null;

  return (
    <div>
      <div className="ui-page-head" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>Scheduled Reports</h2>
          <p className="desc">Manage report schedules, recipients, and delivery settings for each section.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="Secondary"
            size="Small"
            label="Export overrides"
            onClick={() => void downloadOverridesExport().catch((err) => setError(err instanceof Error ? err.message : 'Export failed.'))}
          />
          <Button variant="Secondary" size="Small" label="Import overrides" onClick={() => setShowImport(true)} />
          {data && (
            <Button
              variant={data.pauseAll ? 'Primary' : 'Secondary'}
              color={data.pauseAll ? 'Primary' : 'Negative'}
              size="Small"
              label={data.pauseAll ? 'Resume all reports' : 'Pause all reports'}
              onClick={() => setShowPauseAll(true)}
            />
          )}
        </div>
      </div>

      <p className="BodySmallRegular ui-muted" style={{ padding: '6px 24px 0', margin: 0 }}>
        Changes go to the runtime overrides file (never .env) and apply from each section's next
        scheduled run. Send times come from .env and are read-only here.
      </p>

      {notice && <div className="ui-alert ui-fade-in" style={{ background: 'var(--ui-green-bg)', color: 'var(--ui-green)' }}>{notice}</div>}
      {data?.pauseAll && (
        <div className="ui-alert is-red"><strong>All scheduled reports are currently paused.</strong> Sections are skipped at their send time and each skip is logged.</div>
      )}
      {data && data.overrideErrors.length > 0 && (
        <div className="ui-alert is-amber">
          Invalid lines in the overrides file (ignored by the scheduler):
          <ul>
            {data.overrideErrors.map((e) => (
              <li key={e.line}>line {e.line}: “{e.text}” — {e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="ui-alert is-red">
          <strong>Unable to load schedules.</strong> {error}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); void load(); }}>Try again</a>
        </div>
      )}

      {loading && (
        <div aria-busy="true" aria-label="Loading schedules" style={{ marginTop: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="ui-skel-row" key={i}>
              <div className="ui-skel" style={{ width: 110 }} />
              <div className="ui-skel" style={{ width: 55 }} />
              <div className="ui-skel" style={{ width: 55 }} />
              <div className="ui-skel" style={{ width: 70 }} />
              <div className="ui-skel" style={{ width: 100 }} />
              <div className="ui-skel" style={{ flex: 1, maxWidth: 220 }} />
            </div>
          ))}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="ui-table-wrap" style={{ padding: '16px 16px' }}>
          <Table data={{ nodes: rows }}>
            {(visibleRows: ScheduleRow[]) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Frequency</TableHeaderCell>
                    <TableHeaderCell>Scheduled time (IST)</TableHeaderCell>
                    <TableHeaderCell>Schedule state</TableHeaderCell>
                    <TableHeaderCell>Recipients</TableHeaderCell>
                    <TableHeaderCell>Last run</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell contentType="text"><CellText title={row.name} /></TableCell>
                      <TableCell contentType="text">
                        <span className="BodySmallRegular">{row.type === 'daily' ? 'Daily' : 'Weekly'}</span>
                      </TableCell>
                      <TableCell contentType="text"><CellText title={row.sendTime} /></TableCell>
                      <TableCell contentType="text">
                        <Badge
                          size="Small"
                          color={row.paused || data?.pauseAll ? 'Neutral' : 'Positive'}
                          label={data?.pauseAll ? 'Paused (all)' : row.paused ? 'Paused' : 'Active'}
                        />
                      </TableCell>
                      <TableCell contentType="text">
                        <span className="BodySmallRegular" title={`To: ${row.recipients.join(', ')}${row.cc?.length ? `\nCc: ${row.cc.join(', ')}` : ''}`}>
                          {row.recipients.length} To
                          {row.cc?.length > 0 && <span> · {row.cc.length} Cc</span>}
                          {row.recipientsOverridden && <span className="ui-muted-3"> · overridden</span>}
                        </span>
                      </TableCell>
                      <TableCell contentType="text">
                        {row.lastRun ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={row.lastRun.error ?? undefined}>
                            <Badge size="Small" color={LAST_RUN_COLOR[row.lastRun.status] ?? 'Neutral'} label={row.lastRun.status} />
                            <span className="BodySmallRegular ui-muted">{formatTime(row.lastRun.time)}</span>
                          </div>
                        ) : (
                          <span className="BodySmallRegular ui-muted-3">No runs recorded</span>
                        )}
                      </TableCell>
                      <TableCell contentType="text">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button
                            variant="Secondary"
                            size="XSmall"
                            isLoading={busyKey === row.key}
                            label={row.paused ? 'Resume' : 'Pause'}
                            onClick={() => void togglePause(row)}
                          />
                          <Button variant="Gray" size="XSmall" label="Edit recipients" onClick={() => setEditingKey(row.id)} />
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

      {!loading && !error && rows.length === 0 && (
        <div className="ui-page-head" style={{ paddingBottom: 24 }}>
          <p className="BodySmallRegular ui-muted">No scheduled reports available. Check the schedule configuration (.env) on the server.</p>
        </div>
      )}

      {editingRow && (
        <RecipientsModal
          row={editingRow}
          onClose={() => setEditingKey(null)}
          onSaved={() => {
            setEditingKey(null);
            void load();
            flash(`Recipients for ${editingRow.name} saved — applies from its next scheduled run.`);
          }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onApplied={() => {
            setShowImport(false);
            void load();
            flash('Overrides imported and applied.');
          }}
        />
      )}
      {showPauseAll && data && (
        <PauseAllModal
          pauseAllActive={data.pauseAll}
          busy={busyKey === '__all__'}
          onClose={() => setShowPauseAll(false)}
          onConfirm={() => void confirmPauseAll()}
        />
      )}
    </div>
  );
}
