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
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
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

const TYPE_OPTIONS = [
  { id: '', label: 'All types' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'generated', label: 'Generated (on-demand)' },
];

const STATUS_OPTIONS = [
  { id: '', label: 'All statuses' },
  { id: 'sent', label: 'Sent' },
  { id: 'generated', label: 'Generated' },
  { id: 'failed', label: 'Failed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'generation-failed', label: 'Generation failed' },
];

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
export function ReportLogTable({ reloadToken }: { reloadToken?: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
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
      const { total, entries } = await fetchReportLog({ type, status, q: search, limit: 500 });
      setTotal(total);
      setRows(entries.map((e, i) => ({ ...e, id: `${e.time}-${i}` })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the report log.');
    } finally {
      setLoading(false);
    }
  }, [type, status, search]);

  useEffect(() => {
    void load();
    // reloadToken bumps after an on-demand generation so the fresh rows appear.
  }, [load, reloadToken]);

  return (
    <div className="global-p-06">
      <div style={{ display: 'flex', gap: 'var(--spacing-04)', alignItems: 'flex-end', marginBottom: 'var(--spacing-04)', flexWrap: 'wrap' }}>
        <FilterSelect label="Report type" options={TYPE_OPTIONS} value={type} onChange={setType} />
        <FilterSelect label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-01)' }}>
          <label className="BodySmallRegular" htmlFor="log-search">Search (section / file / recipient)</label>
          <input
            id="log-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. CPP-575 or an email"
            style={{
              padding: '8px 12px',
              border: '1px solid var(--border-neutral-default, #ccc)',
              borderRadius: 6,
              minWidth: 260,
              font: 'inherit',
            }}
          />
        </div>
        <Button variant="Secondary" label="Refresh" onClick={() => void load()} />
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-08)' }}>
          <Spinner label="Loading…" />
        </div>
      )}
      {error && !loading && (
        <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)' }}>{error}</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="No log entries"
          description="No report sends match these filters yet."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <Table
            data={{ nodes: rows }}
            pagination
            defaultPageSize={25}
            toolbar={<TableToolbar title="Report Logs" subtitle={`${rows.length} shown of ${total} entries (newest first)`} />}
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
                        <Button variant="Gray" label="View details" onClick={() => setDetailRow(row)} />
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
