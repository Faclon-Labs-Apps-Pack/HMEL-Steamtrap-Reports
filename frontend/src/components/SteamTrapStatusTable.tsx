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
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { StatusBadge } from './StatusBadge';
import type { Device, LastDataPoint } from '../types/device';

export interface SteamTrapRow {
  id: string;
  device: Device;
  status: LastDataPoint['value'] | undefined;
  department: string | undefined;
  [key: string]: unknown;
}

interface SteamTrapStatusTableProps {
  rows: SteamTrapRow[];
}

export function SteamTrapStatusTable({ rows }: SteamTrapStatusTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<NoDataOneIllustration size={90} />}
        title="No steam trap devices found"
        description="No devices matching device type 'steam trap' were returned by IOsense."
      />
    );
  }

  return (
    <Table data={{ nodes: rows }}>
      {(visibleRows: SteamTrapRow[]) => (
        <>
          <TableHeader>
            <TableHeaderRow>
              <TableHeaderCell>Device Name</TableHeaderCell>
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Current Status</TableHeaderCell>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.device.devID} item={row}>
                <TableCell contentType="text">
                  <CellText title={row.device.devName} />
                </TableCell>
                <TableCell contentType="text">
                  <CellText title={row.department ?? '—'} />
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
  );
}
