import type { Worksheet } from 'exceljs';
import { STATUS_COLUMNS, classifyStatus } from '../lib/statusClassification';
import type { DailyAnalysisRow } from '../lib/buildDailyReportRows';
import { ALL_BORDERS, HEADER_FILL, HEADER_FONT } from './xlsxStyles';

const HEADERS = [
  'Sr No',
  'Device ID',
  'Location',
  'Department',
  'Current Status',
  'Duration (hrs)',
  ...STATUS_COLUMNS,
  'Change in Status',
  'Number of Corrective Actions',
  'Number of Feedbacks',
  'Leak Rate',
  'Cost of Steam',
];

/**
 * Populates the Daily Report's "Analysis" sheet — one row per device, ALL devices together
 * (no plant-category split, per explicit spec). Leak Rate and Cost of Steam are real (device
 * `properties`, confirmed live); there's no separate "Name" field distinct from Device ID in
 * real data (the source template's short codes like "510-HPST-001" don't exist here), so that
 * column is dropped rather than duplicating Device ID under a different header.
 */
export function buildDailyAnalysisSheet(sheet: Worksheet, rows: DailyAnalysisRow[]): void {
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
      row.srNo,
      row.devID,
      row.location,
      row.department,
      classifyStatus(row.currentStatus),
      Number(row.durationHours.toFixed(1)),
      ...STATUS_COLUMNS.map((col) => `${row.statusPercentages[col].toFixed(1)}%`),
      row.statusChangeCount,
      row.correctiveActionCount,
      row.feedbackCount,
      row.leakRate,
      row.costOfSteam,
    ];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
    });
  });
}
