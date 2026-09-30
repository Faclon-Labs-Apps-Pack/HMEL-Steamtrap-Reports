import { useEffect, useRef, useState } from 'react';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { Badge } from '@faclon-labs/design-sdk';
import {
  fetchSections,
  startGeneration,
  fetchJob,
  generatedDownloadUrl,
  type Section,
  type GenerateJob,
} from '../services/adminApi';

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

export function GenerateReportPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
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
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSections()
      .then(({ sections }) => setSections(sections))
      .catch((err) => setSectionsError(err instanceof Error ? err.message : 'Failed to load sections.'));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const toggle = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const running = job?.status === 'running';

  async function handleGenerate() {
    setError(null);
    setJob(null);
    try {
      const { jobId } = await startGeneration([...selectedKeys], new Date(start).toISOString(), new Date(end).toISOString());
      const poll = async () => {
        try {
          const j = await fetchJob(jobId);
          setJob(j);
          if (j.status !== 'running' && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
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
    <div className="global-p-06" style={{ maxWidth: 900 }}>
      <h1 className="HeadingSmallSemibold" style={{ marginTop: 0 }}>Generate Analysis Report</h1>
      <p className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #666)' }}>
        Builds the same Analysis sheet as the scheduled Daily Report, but for a custom time range
        (up to 31 days), one file per selected section. The file downloads in your browser — no
        email is sent and the daily/weekly schedules are not affected.
      </p>

      <div style={{ display: 'flex', gap: 'var(--spacing-06)', alignItems: 'flex-end', flexWrap: 'wrap', margin: 'var(--spacing-05) 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
          <label className="BodySmallRegular" htmlFor="gen-start">Start</label>
          <input id="gen-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
          <label className="BodySmallRegular" htmlFor="gen-end">End</label>
          <input id="gen-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
        </div>
        <Button
          variant="Primary"
          isLoading={running}
          label={running ? (job?.progressLabel ?? 'Generating…') : 'Generate Report'}
          onClick={() => void handleGenerate()}
        />
      </div>

      <div style={{ margin: 'var(--spacing-04) 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)', marginBottom: 'var(--spacing-02)' }}>
          <span className="BodyMediumSemibold">Sections</span>
          <span className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #666)' }}>
            {selectedKeys.size === 0 ? 'none selected = ALL sections' : `${selectedKeys.size} selected`}
          </span>
          <Button variant="Gray" label="Clear selection" onClick={() => setSelectedKeys(new Set())} />
        </div>
        {sectionsError && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{sectionsError}</p>}
        {!sectionsError && sections.length === 0 && <Spinner label="Loading sections…" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 'var(--spacing-02)' }}>
          {sections.map((s) => (
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
                background: selectedKeys.has(s.key) ? 'var(--surface-brand-lightest, #eef4ff)' : undefined,
              }}
            >
              <input type="checkbox" checked={selectedKeys.has(s.key)} onChange={() => toggle(s.key)} />
              {s.name}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{error}</p>}

      {job && (
        <div className="ui-fade-in" style={{ marginTop: 'var(--spacing-05)', padding: 'var(--spacing-04)', border: '1px solid var(--border-neutral-default, #ddd)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-03)' }}>
            <Badge
              size="Small"
              color={job.status === 'done' ? 'Positive' : job.status === 'failed' ? 'Negative' : 'Information'}
              label={job.status}
            />
            <span className="BodySmallRegular">{job.progressLabel}</span>
            {job.status === 'running' && <Spinner />}
          </div>
          {job.error && (
            <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)', marginBottom: 0 }}>{job.error}</p>
          )}
          {job.files.length > 0 && (
            <ul style={{ margin: 'var(--spacing-03) 0 0', paddingLeft: 'var(--spacing-05)' }}>
              {job.files.map((f) => (
                <li key={f.fileName} className="BodySmallRegular" style={{ marginBottom: 4 }}>
                  <a href={generatedDownloadUrl(f.fileName)} download>{f.fileName}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
