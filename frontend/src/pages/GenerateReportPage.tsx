import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { DatePicker, type DateRange } from '@faclon-labs/design-sdk/DatePicker';
import { fetchSections, startGeneration, fetchJob, type Section, type GenerateJob } from '../services/adminApi';
import { ReportLogTable } from './ViewReportsPage';

/** Parent-plant order preferred in the picker; anything else follows, alphabetically. */
function orderedCategories(sections: Section[]): string[] {
  const present = [...new Set(sections.map((s) => s.category).filter(Boolean))];
  const preferred = ['Refinery', 'Petchem'];
  return [...preferred.filter((c) => present.includes(c)), ...present.filter((c) => !preferred.includes(c)).sort()];
}

/** Small numbered circle for the form's step labels. */
function StepBadge({ n }: { n: number }) {
  return <span className="ui-step-badge">{n}</span>;
}

/**
 * The Generate Report tab. The form lives INLINE on the page (per client request 2026-10-19 — no
 * modal): pick a plant (radio), pick its units (checkbox chips), set the range, and the Generate
 * button sits below the form. Generated reports appear in the table underneath with a download.
 */
export function GenerateReportPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [parent, setParent] = useState('');
  const [childKeys, setChildKeys] = useState<Set<string>>(new Set());
  // Default range: yesterday 00:00 -> today 00:00 (the last full day).
  const [range, setRange] = useState<DateRange | null>(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { start, end };
  });
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The date picker opens as a modal with origin-aware animations: it GROWS OUT of the trigger
  // field and shrinks BACK INTO it on close. The trigger's offset from the viewport center is
  // measured at open/close time (it may have scrolled between the two) and handed to the CSS
  // keyframes as --picker-dx/--picker-dy — the popover is portaled to <body>, so the vars go on
  // the root element. The SDK unmounts its popover the moment isOpen flips false, which would
  // cut the exit animation — so closing is two-phase: flag `pickerClosing` (CSS plays the
  // out-animation), THEN flip isOpen once it has finished.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerClosing, setPickerClosing] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  const setPickerOrigin = () => {
    const trigger = pickerWrapRef.current?.querySelector('.fds-date-trigger__field');
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--picker-dx', `${r.x + r.width / 2 - window.innerWidth / 2}px`);
    root.setProperty('--picker-dy', `${r.y + r.height / 2 - window.innerHeight / 2}px`);
  };

  const handlePickerOpenChange = (open: boolean) => {
    if (open) {
      setPickerOrigin();
      setPickerClosing(false);
      setPickerOpen(true);
    } else if (!pickerClosing) {
      setPickerOrigin();
      setPickerClosing(true);
      window.setTimeout(() => {
        setPickerOpen(false);
        setPickerClosing(false);
      }, 210);
    }
  };

  useEffect(() => {
    fetchSections()
      .then(({ sections }) => setSections(sections))
      .catch((err) => setSectionsError(err instanceof Error ? err.message : 'Failed to load sections.'));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const categories = orderedCategories(sections);
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
    setSuccessMsg(null);
    if (!parent) return setError('Select a plant first.');
    if (childKeys.size === 0) return setError('Select at least one unit.');
    if (!range) return setError('Select a time range.');
    if (range.start >= range.end) return setError('Start must be before end.');
    setJob(null);
    try {
      const { jobId } = await startGeneration([...childKeys], range.start.toISOString(), range.end.toISOString());
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
              setSuccessMsg(`Generated ${j.files.length} report${j.files.length === 1 ? '' : 's'} — download below.`);
              setReloadToken((n) => n + 1);
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
    <div>
      <div className="ui-page-head">
        <h2>Generate Report</h2>
        <p className="desc">
          Build an on-demand steam trap analysis report for a selected plant, section, and time range.
        </p>
        <span className="note">On-demand reports are generated for review. No email is sent.</span>
      </div>

      {/* --- Guided inline workflow: whitespace + dividers, no nested card --- */}
      <div className="ui-steps">
        {sectionsError && <p className="BodySmallRegular" style={{ color: 'var(--ui-red)', margin: '16px 0 0' }}>{sectionsError}</p>}
        {!sectionsError && sections.length === 0 && (
          <div style={{ padding: '16px 0 0' }}><Spinner label="Loading plants & units…" /></div>
        )}

        {sections.length > 0 && (
          <>
            {/* Step 1 — plant (segmented control over radio inputs) */}
            <div className="ui-step">
              <div className="ui-step-label"><StepBadge n={1} /> Select plant</div>
              <div className="ui-seg" role="radiogroup" aria-label="Plant">
                {categories.map((c) => (
                  <label key={c} className={parent === c ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="plant"
                      value={c}
                      checked={parent === c}
                      onChange={() => {
                        setParent(c);
                        setChildKeys(new Set()); // reset units when the plant changes
                      }}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* Step 2 — units of the chosen plant */}
            {parent && (
              <div className="ui-step ui-fade-in" key={parent}>
                <div className="ui-step-label">
                  <StepBadge n={2} /> Select sections in {parent}
                  <span className="hint">
                    {childKeys.size === 0 ? 'none selected' : `${childKeys.size} selected`}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
                    <Button variant="Gray" size="XSmall" label="Select all" onClick={() => setChildKeys(new Set(children.map((s) => s.key)))} />
                    {childKeys.size > 0 && <Button variant="Gray" size="XSmall" label="Clear selection" onClick={() => setChildKeys(new Set())} />}
                  </span>
                </div>
                <div className="ui-chips">
                  {children.map((s) => (
                    <label key={s.key} className={`ui-select-card${childKeys.has(s.key) ? ' is-selected' : ''}`}>
                      <input type="checkbox" checked={childKeys.has(s.key)} onChange={() => toggleChild(s.key)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3 — date & time range (design-sdk range picker with HH:MM time inputs) */}
            {parent && (
              <div className="ui-step ui-fade-in">
                <div className="ui-step-label"><StepBadge n={3} /> Select time range</div>
                <div ref={pickerWrapRef} style={{ maxWidth: 360 }} className={`ui-picker${pickerClosing ? ' is-closing' : ''}`}>
                  {/* Portaled to <body>: an animated ancestor's transform would otherwise trap
                      this fixed-position backdrop inside the step (the SDK portals its popover
                      the same way). */}
                  {pickerOpen &&
                    createPortal(
                      <div className={`ui-picker-backdrop${pickerClosing ? ' is-closing' : ''}`} aria-hidden />,
                      document.body,
                    )}
                  <DatePicker
                    mode="range"
                    showTime
                    showPresets={false}
                    showPresetChip={false}
                    label="Reporting period"
                    rangeValue={range}
                    onRangeChange={setRange}
                    isOpen={pickerOpen}
                    onOpenChange={handlePickerOpenChange}
                  />
                </div>
              </div>
            )}

            {/* Primary action below the form, with progress + result feedback */}
            <div className="ui-step" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Button
                variant="Primary"
                isLoading={running}
                label={running ? (job?.progressLabel ?? 'Generating…') : 'Generate Report'}
                onClick={() => void handleGenerate()}
              />
              {error && <span className="BodySmallRegular" style={{ color: 'var(--ui-red)' }}>{error}</span>}
              {successMsg && <span className="BodySmallRegular ui-fade-in" style={{ color: 'var(--ui-green)' }}>{successMsg}</span>}
            </div>
          </>
        )}
      </div>

      <hr className="ui-divider" style={{ margin: 0 }} />

      {/* --- Generated reports (on-demand only) --- */}
      <ReportLogTable mode="generated" reloadToken={reloadToken} />
    </div>
  );
}
