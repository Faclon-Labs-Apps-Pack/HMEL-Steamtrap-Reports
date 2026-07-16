import type { Worksheet } from 'exceljs';
import { STATUS_COLUMNS } from '../lib/statusClassification';
import { classifyStatus } from '../lib/statusClassification';
import type { DeviceDetailRow } from '../lib/buildDeviceDetailRows';
import { ALL_BORDERS, HEADER_FILL, HEADER_FONT } from './xlsxStyles';

const HEADERS = [
  'Device ID',
  'Location',
  'Unit',
  'Current Status',
  'Duration (hrs)',
  ...STATUS_COLUMNS,
  'Change in Status',
  'Number of Corrective Actions',
  'Number of Feedbacks',
  'Leak Rate',
  'Steam Saving (MT)',
  'Steam Loss (MT)',
  'Cost of Steam(Rs/Ton)',
  'Loss (INR)',
  'Savings (INR)',
];

/** Populates a "Refinery"/"Petchem" per-device detail sheet — one row per device in that category, current-week windowed. */
export function buildDetailSheet(sheet: Worksheet, rows: DeviceDetailRow[]): void {
  sheet.columns = HEADERS.map((h) => ({ width: h === 'Location' ? 40 : Math.max(14, h.length + 2) }));

  const headerRow = sheet.getRow(1);
  headerRow.values = HEADERS;
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = ALL_BORDERS;
  });

  rows.forEach((row, i) => {
    const excelRow = sheet.getRow(i + 2);
    excelRow.values = [
      row.devID,
      row.location,
      row.unit,
      classifyStatus(row.currentStatus),
      Number(row.durationHours.toFixed(1)),
      ...STATUS_COLUMNS.map((col) => `${row.statusPercentages[col].toFixed(1)}%`),
      row.statusChangeCount,
      row.correctiveActionCount,
      row.feedbackCount,
      row.leakRate,
      Number(row.steamSavingMT.toFixed(2)),
      Number(row.steamLossMT.toFixed(2)),
      row.costOfSteamPerTon ?? 'N/A',
      row.lossINR !== undefined ? Number(row.lossINR.toFixed(2)) : 'N/A',
      row.savingsINR !== undefined ? Number(row.savingsINR.toFixed(2)) : 'N/A',
    ];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
    });
  });
}
