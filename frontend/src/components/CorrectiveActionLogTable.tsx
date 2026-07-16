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
import type { CorrectiveActionLogRow } from '../lib/buildCorrectiveActionLogRows';

interface CorrectiveActionLogTableProps {
  rows: CorrectiveActionLogRow[];
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function CorrectiveActionLogTable({ rows }: CorrectiveActionLogTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<NoDataOneIllustration size={90} />}
        title="No corrective actions logged"
        description="No trap replacement / corrective action records were found for these devices."
      />
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table
        data={{ nodes: rows }}
        pagination
        defaultPageSize={25}
        toolbar={<TableToolbar title="Corrective Action Log" subtitle={`${rows.length} records`} />}
        footer={<TablePagination />}
      >
        {(visibleRows: CorrectiveActionLogRow[]) => (
          <>
            <TableHeader>
              <TableHeaderRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Unit Name</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Manufacturer</TableHeaderCell>
                <TableHeaderCell>Trap Size</TableHeaderCell>
                <TableHeaderCell>Failure</TableHeaderCell>
                <TableHeaderCell>Corrective Action</TableHeaderCell>
                <TableHeaderCell>Date and Time</TableHeaderCell>
                <TableHeaderCell>Remark</TableHeaderCell>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id} item={row}>
                  <TableCell contentType="text">
                    <CellText title={row.name} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.unitName} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.location} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.manufacturer} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.trapSize} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.failure} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.correctiveAction} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={formatDateTime(row.dateAndTime)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.remark || '—'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </>
        )}
      </Table>
    </div>
  );
}
