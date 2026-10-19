import { useEffect, useRef, useState } from 'react';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { fetchSections, startGeneration, fetchJob, type Section, type GenerateJob } from '../services/adminApi';
import { FilterSelect, ReportLogTable } from './ViewReportsPage';

/** yyyy-MM-ddTHH:mm for <input type="datetime-local">, in the browser's local time. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--border-neutral-default, #ccc)',
  borderRadius: 6,
  font: 'inherit',
};

/** Parent-plant order preferred in the picker; anything else follows, alphabetically. */
function orderedCategories(sections: Section[]): string[] {
  const present = [...new Set(sections.map((s) => s.category).filter(Boolean))];
  const preferred = ['Refinery', 'Petchem'];
  return [...preferred.filter((c) => present.includes(c)), ...present.filter((c) => !preferred.includes(c)).sort()];
}

/**
 * On-demand generation modal: pick a parent plant, then the child units under it, set the date/time
 * range, and generate. Each generated report is written to the shared log (see backend), so it
 * appears in the table below with a Download.
 */
function GenerateModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [parent, setParent] = useState('');
  const [childKeys, setChildKeys] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return toLocalInputValue(d);
  });
  const [end, setEnd] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalInputValue(d);
  });
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSections()
      .then(({ sections }) => setSections(sections))
      .catch((err) => setSectionsError(err instanceof Error ? err.message : 'Failed to load sections.'));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const categories = orderedCategories(sections);
  const parentOptions = [{ id: '', label: 'Select plant…' }, ...categories.map((c) => ({ id: c, label: c }))];
  const children = parent ? sections.filter((s) => s.category === parent) : [];
  const running = job?.status === 'running';

  const toggleChild = (key: string) =>
    setChildKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function handleGenerate() {
    setError(null);
    if (!parent) return setError('Select a plant first.');
    if (childKeys.size === 0) return setError('Select at least one unit.');
    if (new Date(start) >= new Date(end)) return setError('Start must be before end.');
    setJob(null);
    try {
      const { jobId } = await startGeneration([...childKeys], new Date(start).toISOString(), new Date(end).toISOString());
      const poll = async () => {
        try {
          const j = await fetchJob(jobId);
          setJob(j);
          if (j.status !== 'running') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            if (j.status === 'done') {
              onGenerated();
              onClose();
            } else if (j.status === 'failed') {
              setError(j.error ?? 'Generation failed.');
            }
          }
        } catch {
          // transient poll failure — keep polling
        }
      };
      await poll();
      pollRef.current = setInterval(poll, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation.');
    }
  }

  return (
    <Modal
      isOpen
      size="Medium"
      onClose={onClose}
      header={
        <ModalHeader
          title="Generate Report"
          subtitle="Custom-range Analysis report (up to 31 days) — no email is sent."
          onClose={onClose}
        />
      }
      footer={
        <ModalFooter
          primaryAction={
            <Button
              variant="Primary"
              isLoading={running}
              label={running ? (job?.progressLabel ?? 'Generating…') : 'Generate'}
              onClick={() => void handleGenerate()}
            />
          }
          secondaryAction={<Button variant="Secondary" label="Cancel" onClick={onClose} />}
        />
      }
    >
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-05)' }}>
          {sectionsError && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{sectionsError}</p>}
          {!sectionsError && sections.length === 0 && <Spinner label="Loading units…" />}

          {/* Step 1 — parent plant */}
          <FilterSelect
            label="Plant"
            options={parentOptions}
            value={parent}
            onChange={(id) => {
              setParent(id);
              setChildKeys(new Set()); // reset children when the parent changes
            }}
          />

          {/* Step 2 — child units of the chosen plant */}
          {parent && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)', marginBottom: 'var(--spacing-02)' }}>
                <span className="BodyMediumSemibold">Units in {parent}</span>
                <span className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #667085)' }}>
                  {childKeys.size === 0 ? 'none selected' : `${childKeys.size} selected`}
                </span>
                {childKeys.size > 0 && <Button variant="Gray" label="Clear" onClick={() => setChildKeys(new Set())} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--spacing-02)' }}>
                {children.map((s) => (
                  <label
                    key={s.key}
                    className="BodySmallRegular ui-select-card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px solid var(--border-neutral-default, #ddd)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: childKeys.has(s.key) ? 'var(--surface-brand-lightest, #eef4ff)' : undefined,
                    }}
                  >
                    <input type="checkbox" checked={childKeys.has(s.key)} onChange={() => toggleChild(s.key)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 3 — date & time range (editable) */}
          <div style={{ display: 'flex', gap: 'var(--spacing-05)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
              <label className="BodySmallRegular" htmlFor="gv-start">Start (date &amp; time)</label>
              <input id="gv-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
              <label className="BodySmallRegular" htmlFor="gv-end">End (date &amp; time)</label>
              <input id="gv-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}>
              <Spinner />
              <span className="BodySmallRegular">{job?.progressLabel}</span>
            </div>
          )}
          {error && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)', margin: 0 }}>{error}</p>}
        </div>
      </ModalBody>
    </Modal>
  );
}

export function GenerateViewPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div>
      <div className="global-p-06" style={{ paddingBottom: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-04)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="HeadingSmallSemibold" style={{ margin: 0 }}>Reports</h1>
          <p className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #667085)', margin: '2px 0 0' }}>
            Generate an on-demand report, or browse the send log below.
          </p>
        </div>
        <Button variant="Primary" label="Generate Report" onClick={() => setModalOpen(true)} />
      </div>

      <ReportLogTable reloadToken={reloadToken} />

      {modalOpen && (
        <GenerateModal
          onClose={() => setModalOpen(false)}
          onGenerated={() => setReloadToken((n) => n + 1)}
        />
      )}
    </div>
  );
}
