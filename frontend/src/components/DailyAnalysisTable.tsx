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
import { StatusBadge } from './StatusBadge';
import { STATUS_COLUMNS } from '../lib/statusClassification';
import type { DailyAnalysisRow } from '../lib/buildDailyReportRows';

interface DailyAnalysisTableProps {
  rows: DailyAnalysisRow[];
}

/** Mirrors the Daily Report's "Analysis" sheet columns exactly — see buildDailyAnalysisSheet.ts. */
export function DailyAnalysisTable({ rows }: DailyAnalysisTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<NoDataOneIllustration size={90} />}
        title="No devices found"
        description="No steam trap devices were found for today's analysis."
      />
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table
        data={{ nodes: rows }}
        pagination
        defaultPageSize={25}
        toolbar={<TableToolbar title="Analysis" subtitle={`${rows.length} devices`} />}
        footer={<TablePagination />}
      >
        {(visibleRows: DailyAnalysisRow[]) => (
          <>
            <TableHeader>
              <TableHeaderRow>
                <TableHeaderCell>Sr No</TableHeaderCell>
                <TableHeaderCell>Device ID</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Current Status</TableHeaderCell>
                <TableHeaderCell>Duration (hrs)</TableHeaderCell>
                {STATUS_COLUMNS.map((col) => (
                  <TableHeaderCell key={col}>{col}</TableHeaderCell>
                ))}
                <TableHeaderCell>Change in Status</TableHeaderCell>
                <TableHeaderCell>Number of Corrective Actions</TableHeaderCell>
                <TableHeaderCell>Number of Feedbacks</TableHeaderCell>
                <TableHeaderCell>Leak Rate</TableHeaderCell>
                <TableHeaderCell>Cost of Steam</TableHeaderCell>
                <TableHeaderCell>Saving</TableHeaderCell>
                <TableHeaderCell>Loss</TableHeaderCell>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id} item={row}>
                  <TableCell contentType="text">
                    <CellText title={String(row.srNo)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.devID} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.location} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.department} />
                  </TableCell>
                  <TableCell contentType="text">
                    <StatusBadge value={row.currentStatus} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.durationHours.toFixed(1)} />
                  </TableCell>
                  {STATUS_COLUMNS.map((col) => (
                    <TableCell key={col} contentType="text">
                      <CellText title={`${row.statusPercentages[col].toFixed(1)}%`} />
                    </TableCell>
                  ))}
                  <TableCell contentType="text">
                    <CellText title={String(row.statusChangeCount)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={String(row.correctiveActionCount)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={String(row.feedbackCount)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.leakRate} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.costOfSteam} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.steamSaving.toFixed(2)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.steamLoss.toFixed(2)} />
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
