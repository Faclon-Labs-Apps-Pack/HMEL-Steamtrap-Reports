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
import type { DailyLiveStatusRow } from '../lib/buildDailyReportRows';

interface DailyLiveStatusTableProps {
  rows: DailyLiveStatusRow[];
}

/** Mirrors the Daily Report's "Live Status" sheet columns exactly — see buildDailyLiveStatusSheet.ts. */
export function DailyLiveStatusTable({ rows }: DailyLiveStatusTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<NoDataOneIllustration size={90} />}
        title="No devices found"
        description="No steam trap devices were found."
      />
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table
        data={{ nodes: rows }}
        pagination
        defaultPageSize={25}
        toolbar={<TableToolbar title="Live Status" subtitle={`${rows.length} devices`} />}
        footer={<TablePagination />}
      >
        {(visibleRows: DailyLiveStatusRow[]) => (
          <>
            <TableHeader>
              <TableHeaderRow>
                <TableHeaderCell>Sr No</TableHeaderCell>
                <TableHeaderCell>Device ID</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Inlet Pressure</TableHeaderCell>
                <TableHeaderCell>Outlet Pressure</TableHeaderCell>
                <TableHeaderCell>Inlet BaseLine Temperature</TableHeaderCell>
                <TableHeaderCell>Outlet BaseLine Temperature</TableHeaderCell>
                <TableHeaderCell>Live Inlet Temperature</TableHeaderCell>
                <TableHeaderCell>Live Outlet Temperature</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
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
                    <CellText title={row.inletPressure} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.outletPressure} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.baseLineInletTemperature} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.baseLineOutletTemperature} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.liveInletTemperature} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.liveOutletTemperature} />
                  </TableCell>
                  <TableCell contentType="text">
                    <StatusBadge value={row.status} />
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
