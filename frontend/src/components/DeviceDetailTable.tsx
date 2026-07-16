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
import type { DeviceDetailRow } from '../lib/buildDeviceDetailRows';

interface DeviceDetailTableProps {
  rows: DeviceDetailRow[];
}

export function DeviceDetailTable({ rows }: DeviceDetailTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<NoDataOneIllustration size={90} />}
        title="No devices match this filter"
        description="Try a different category or date range."
      />
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table
        data={{ nodes: rows }}
        pagination
        defaultPageSize={25}
        toolbar={<TableToolbar title="Device Detail Report" subtitle={`${rows.length} devices`} />}
        footer={<TablePagination />}
      >
        {(visibleRows: DeviceDetailRow[]) => (
          <>
            <TableHeader>
              <TableHeaderRow>
                <TableHeaderCell>Device ID</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Unit</TableHeaderCell>
                <TableHeaderCell>Current Status</TableHeaderCell>
                <TableHeaderCell>Duration (hrs)</TableHeaderCell>
                {STATUS_COLUMNS.map((col) => (
                  <TableHeaderCell key={col}>{col}</TableHeaderCell>
                ))}
                <TableHeaderCell>Change in Status</TableHeaderCell>
                <TableHeaderCell>No. of Corrective Actions</TableHeaderCell>
                <TableHeaderCell>No. of Feedbacks</TableHeaderCell>
                <TableHeaderCell>Leak Rate</TableHeaderCell>
                <TableHeaderCell>Steam Saving (MT)</TableHeaderCell>
                <TableHeaderCell>Steam Loss (MT)</TableHeaderCell>
                <TableHeaderCell>Cost of Steam (Rs/Ton)</TableHeaderCell>
                <TableHeaderCell>Loss (INR)</TableHeaderCell>
                <TableHeaderCell>Savings (INR)</TableHeaderCell>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.devID} item={row}>
                  <TableCell contentType="text">
                    <CellText title={row.devID} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.location} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.unit} />
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
                    <CellText title={row.steamSavingMT.toFixed(2)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.steamLossMT.toFixed(2)} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.costOfSteamPerTon !== undefined ? String(row.costOfSteamPerTon) : 'N/A'} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.lossINR !== undefined ? row.lossINR.toFixed(2) : 'N/A'} />
                  </TableCell>
                  <TableCell contentType="text">
                    <CellText title={row.savingsINR !== undefined ? row.savingsINR.toFixed(2) : 'N/A'} />
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
