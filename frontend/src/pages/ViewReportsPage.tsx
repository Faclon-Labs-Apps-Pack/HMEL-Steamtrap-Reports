import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableHeader,
  TableHeaderRow,
  TableHeaderCell,
  TableRow,
  TableCell,
  TableToolbar,
  TablePagination,
  CellText,
} from '@faclon-labs/design-sdk/Table';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { Badge } from '@faclon-labs/design-sdk';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { Download } from 'lucide-react';
import { fetchReportLog, downloadUrlForEntry, type ReportLogEntry } from '../services/adminApi';

interface FilterOption {
  id: string;
  label: string;
}

/** The design-sdk SelectInput idiom used across this app: controlled open state + DropdownMenu. */
export function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? options[0];
  return (
    <div style={{ minWidth: 190 }}>
      <SelectInput label={label} value={selected.label} isOpen={isOpen} onClick={() => setOpen((o) => !o)}>
        {isOpen && (
          <DropdownMenu>
            {options.map((option) => (
              <ActionListItem
                key={option.id}
                title={option.label}
                isSelected={value === option.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              />
            ))}
          </DropdownMenu>
        )}
      </SelectInput>
    </div>
  );
}

type StatusBadgeColor = 'Positive' | 'Negative' | 'Notice' | 'Neutral';

const STATUS_COLOR: Record<string, StatusBadgeColor> = {
  sent: 'Positive',
  generated: 'Positive',
  failed: 'Negative',
  'generation-failed': 'Negative',
  skipped: 'Notice',
};

interface LogRow extends ReportLogEntry {
  id: string;
  [key: string]: unknown;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Which slice of the shared log a table shows:
 *  - 'scheduled' — only the daily/weekly email sends (the View Reports tab);
 *  - 'generated' — only on-demand custom-range reports (the Generate Report tab);
 *  - 'all'       — everything.
 */
export type LogMode = 'scheduled' | 'generated' | 'all';

const TYPE_OPTIONS: Record<LogMode, FilterOption[]> = {
  all: [
    { id: '', label: 'All types' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'generated', label: 'Generated (on-demand)' },
  ],
  scheduled: [
    { id: '', label: 'All types' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
  ],
  generated: [], // type is fixed — no picker shown
};

const STATUS_OPTIONS: Record<LogMode, FilterOption[]> = {
  all: [
    { id: '', label: 'All statuses' },
    { id: 'sent', label: 'Sent' },
    { id: 'generated', label: 'Generated' },
    { id: 'failed', label: 'Failed' },
    { id: 'skipped', label: 'Skipped' },
    { id: 'generation-failed', label: 'Generation failed' },
  ],
  scheduled: [
    { id: '', label: 'All statuses' },
    { id: 'sent', label: 'Sent' },
    { id: 'failed', label: 'Failed' },
    { id: 'skipped', label: 'Skipped' },
    { id: 'generation-failed', label: 'Generation failed' },
  ],
  generated: [
    { id: '', label: 'All statuses' },
    { id: 'generated', label: 'Generated' },
    { id: 'generation-failed', label: 'Generation failed' },
  ],
};

const TABLE_TITLE: Record<LogMode, string> = {
  all: 'Report Logs',
  scheduled: 'Report Send Log',
  generated: 'Generated Reports',
};

const EMPTY_STATE: Record<LogMode, { title: string; description: string }> = {
  all: { title: 'No reports found', description: 'Try adjusting your filters or generate a new report.' },
  scheduled: { title: 'No reports found', description: 'No scheduled report sends have been logged yet.' },
  generated: {
    title: 'Ready to generate your report?',
    description: 'Select a plant, choose sections, and specify the reporting period above.',
  },
};

/** A labelled field row in the report-details modal. */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #667085)', fontWeight: 600, marginBottom: 4 }}>
      {children}
    </div>
  );
}
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="BodySmallRegular" style={{ whiteSpace: 'normal' }}>{value}</div>
    </div>
  );
}

/** Modal with the full report name, recipient list and issue — replaces the bulky inline columns. */
function ReportDetailModal({ row, onClose }: { row: LogRow; onClose: () => void }) {
  return (
    <Modal
      isOpen
      size="Medium"
      onClose={onClose}
      header={<ModalHeader title="Report details" subtitle={row.fileName ?? row.section} onClose={onClose} />}
      footer={<ModalFooter secondaryAction={<Button variant="Secondary" label="Close" onClick={onClose} />} />}
    >
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-04)' }}>
          <DetailField label="Report file" value={row.fileName ?? '—'} />
          <div style={{ display: 'flex', gap: 'var(--spacing-06)', flexWrap: 'wrap' }}>
            <DetailField label="Section" value={row.section} />
            <DetailField label="Type" value={row.reportType} />
            <DetailField label="Time (IST)" value={formatTime(row.time)} />
          </div>
          {row.rangeStart && row.rangeEnd && (
            <DetailField label="Report range (IST)" value={`${formatTime(row.rangeStart)}  →  ${formatTime(row.rangeEnd)}`} />
          )}
          <div>
            <FieldLabel>Status</FieldLabel>
            <Badge size="Small" color={STATUS_COLOR[row.status] ?? 'Neutral'} label={row.status} />
          </div>
          <div>
            <FieldLabel>Recipients{row.recipients?.length ? ` (${row.recipients.length})` : ''}</FieldLabel>
            {row.recipients && row.recipients.length > 0 ? (
              <div className="BodySmallRegular" style={{ whiteSpace: 'normal', lineHeight: 1.6 }}>
                {row.recipients.join(', ')}
              </div>
            ) : (
              <span className="BodySmallRegular" style={{ color: 'var(--text-neutral-secondary, #667085)' }}>
                No recipients recorded.
              </span>
            )}
          </div>
          <div>
            <FieldLabel>Issue</FieldLabel>
            {row.error ? (
              <div className="BodySmallRegular" style={{ color: 'var(--text-error-default)', whiteSpace: 'normal' }}>
                {row.error}
              </div>
            ) : (
              <span className="BodySmallRegular" style={{ color: 'var(--text-success-default, #067647)' }}>
                No issue{row.status === 'sent' ? ' — sent successfully' : ` — status: ${row.status}`}.
              </span>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

/**
 * The report send-log table (filters + table + details modal). Reusable: pass a `reloadToken` that
 * changes (e.g. after an on-demand generation) to make it re-fetch and surface the new rows.
 */
export function ReportLogTable({
  reloadToken,
  mode = 'all',
  showMetrics = false,
}: {
  reloadToken?: number;
  mode?: LogMode;
  /** Render the compact summary-metrics row (real counts over the full filtered set). */
  showMetrics?: boolean;
}) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [detailRow, setDetailRow] = useState<LogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { total, counts, entries } = await fetchReportLog({
        // 'generated' mode pins the type; 'scheduled' mode excludes on-demand rows instead.
        type: mode === 'generated' ? 'generated' : type,
        excludeType: mode === 'scheduled' ? 'generated' : undefined,
        status,
        q: search,
        limit: 500,
      });
      setTotal(total);
      setCounts(counts ?? {});
      setRows(entries.map((e, i) => ({ ...e, id: `${e.time}-${i}` })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the report log.');
    } finally {
      setLoading(false);
    }
  }, [type, status, search, mode]);

  useEffect(() => {
    void load();
    // reloadToken bumps after an on-demand generation so the fresh rows appear.
  }, [load, reloadToken]);

  // With nothing in the log AND no filter active there is nothing to filter — hiding the filter
  // row keeps an empty tab clean (just the empty-state card) instead of showing orphaned controls.
  const hasActiveFilter = type !== '' || status !== '' || search !== '';
  const showFilters = loading || rows.length > 0 || hasActiveFilter || !!error;

  const clearFilters = () => {
    setType('');
    setStatus('');
    setSearch('');
  };

  // Real aggregates over the FULL filtered set (computed server-side, not just the visible page).
  const sent = counts['sent'] ?? 0;
  const failed = (counts['failed'] ?? 0) + (counts['generation-failed'] ?? 0);
  const skipped = counts['skipped'] ?? 0;

  return (
    <div>
      {showMetrics && !error && (loading ? total > 0 : rows.length > 0 || hasActiveFilter) && (
        <div className="ui-metrics">
          <div className="ui-metric">
            <div className="value">{total}</div>
            <div className="label">Total report runs</div>
          </div>
          <div className="ui-metric is-green">
            <div className="value">{sent}</div>
            <div className="label">Successfully sent</div>
          </div>
          <div className="ui-metric is-red">
            <div className="value">{failed}</div>
            <div className="label">Failed</div>
          </div>
          <div className="ui-metric is-amber">
            <div className="value">{skipped}</div>
            <div className="label">Skipped</div>
          </div>
        </div>
      )}

      {showFilters && (
      <div className="ui-toolbar" style={showMetrics ? { borderTop: '1px solid var(--ui-border)' } : undefined}>
        {TYPE_OPTIONS[mode].length > 0 && (
          <FilterSelect label="Report type" options={TYPE_OPTIONS[mode]} value={type} onChange={setType} />
        )}
        <FilterSelect label="Status" options={STATUS_OPTIONS[mode]} value={status} onChange={setStatus} />
        <div>
          <label className="ui-field-label" htmlFor="log-search">Search reports</label>
          <input
            className="ui-input"
            id="log-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Section, file name, or recipient"
            style={{ minWidth: 260 }}
          />
        </div>
        {hasActiveFilter && <Button variant="Gray" label="Clear filters" onClick={clearFilters} />}
        <Button variant="Secondary" label="Refresh" onClick={() => void load()} />
      </div>
      )}

      {loading && (
        <div aria-busy="true" aria-label="Loading reports">
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="ui-skel-row" key={i}>
              <div className="ui-skel" style={{ width: 120 }} />
              <div className="ui-skel" style={{ width: 60 }} />
              <div className="ui-skel" style={{ width: 90 }} />
              <div className="ui-skel" style={{ width: 70 }} />
              <div className="ui-skel" style={{ flex: 1, maxWidth: 360 }} />
              <div className="ui-skel" style={{ width: 90 }} />
            </div>
          ))}
        </div>
      )}
      {error && !loading && (
        <div className="ui-alert is-red" style={{ marginBottom: 16 }}>
          <strong>Unable to load reports.</strong> {error}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); void load(); }}>Try again</a>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="ui-fade-in" style={{ padding: '8px 0 24px' }}>
          <EmptyState
            illustration={<NoDataOneIllustration size={72} />}
            title={hasActiveFilter ? 'No reports found' : EMPTY_STATE[mode].title}
            description={hasActiveFilter ? 'Try adjusting your filters or generate a new report.' : EMPTY_STATE[mode].description}
          />
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="ui-table-wrap" style={{ padding: '0 16px 16px' }}>
          <Table
            data={{ nodes: rows }}
            pagination
            defaultPageSize={25}
            toolbar={<TableToolbar title={TABLE_TITLE[mode]} subtitle={`${rows.length} shown of ${total} entries (newest first)`} />}
            footer={<TablePagination />}
          >
            {(visibleRows: LogRow[]) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Time (IST)</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Report File</TableHeaderCell>
                    <TableHeaderCell>Recipients</TableHeaderCell>
                    <TableHeaderCell>Details</TableHeaderCell>
                    <TableHeaderCell>Download</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell contentType="text"><CellText title={formatTime(row.time)} /></TableCell>
                      <TableCell contentType="text"><CellText title={row.reportType} /></TableCell>
                      <TableCell contentType="text"><CellText title={row.section} /></TableCell>
                      <TableCell contentType="text">
                        <Badge size="Small" color={STATUS_COLOR[row.status] ?? 'Neutral'} label={row.status} />
                      </TableCell>
                      <TableCell contentType="text"><CellText title={row.fileName ?? '—'} /></TableCell>
                      <TableCell contentType="text">
                        <CellText title={row.recipients && row.recipients.length > 0 ? `${row.recipients.length} recipient(s)` : '—'} />
                      </TableCell>
                      <TableCell contentType="text">
                        <Button variant="Gray" size="XSmall" label="View details" onClick={() => setDetailRow(row)} />
                      </TableCell>
                      <TableCell contentType="text">
                        {row.downloadable && row.fileName ? (
                          <a
                            href={downloadUrlForEntry(row)}
                            download
                            title={`Download ${row.fileName}`}
                            aria-label={`Download ${row.fileName}`}
                            className="ui-download-btn"
                          >
                            <Download size={16} aria-hidden />
                          </a>
                        ) : (
                          <CellText title="—" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </div>
      )}

      {detailRow && <ReportDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}

/** The View Reports tab: the scheduled (daily/weekly) send log only — on-demand generated reports live on the Generate Report tab. */
export function ViewReportsPage({ scopeLabel }: { scopeLabel?: string }) {
  return (
    <div>
      <div className="ui-page-head">
        <h2>View Reports</h2>
        <p className="desc">
          {scopeLabel
            ? `Reports for your sections (${scopeLabel.replace(/^Read — /, '')}) — delivery outcomes, recipients, and downloads.`
            : 'Review generated reports, delivery outcomes, recipients, and downloadable files.'}
        </p>
      </div>
      <ReportLogTable mode="scheduled" showMetrics />
    </div>
  );
}
