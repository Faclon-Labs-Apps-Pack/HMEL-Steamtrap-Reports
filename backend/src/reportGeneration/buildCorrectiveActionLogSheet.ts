import type { Worksheet } from 'exceljs';
import type { CorrectiveActionLogRow } from '../lib/buildCorrectiveActionLogRows';
import { ALL_BORDERS, HEADER_FILL, HEADER_FONT } from './xlsxStyles';

const HEADERS = [
  'Name',
  'Unit Name',
  'Location',
  'Manufacturer',
  'Trap Size',
  'Failure',
  'Corrective Action',
  'Date and Time',
  'Remark',
];

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

/** Populates the "Corrective Action Log" sheet — every corrective-action record, all-time, newest first. */
export function buildCorrectiveActionLogSheet(sheet: Worksheet, rows: CorrectiveActionLogRow[]): void {
  sheet.columns = HEADERS.map((h) => ({ width: h === 'Name' || h === 'Location' || h === 'Remark' ? 35 : Math.max(16, h.length + 2) }));

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
      row.name,
      row.unitName,
      row.location,
      row.manufacturer,
      row.trapSize,
      row.failure,
      row.correctiveAction,
      formatDateTime(row.dateAndTime),
      row.remark,
    ];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
    });
  });
}
