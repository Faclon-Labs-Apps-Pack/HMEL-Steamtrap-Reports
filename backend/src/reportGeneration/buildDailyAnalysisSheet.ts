import type { Worksheet } from 'exceljs';
import { classifyStatus, type StatusColumn } from '../lib/statusClassification';
import type { DailyAnalysisRow } from '../lib/buildDailyReportRows';
import { ALL_BORDERS, BLUE_HEADER_FILL, HEADER_FONT, RED_FONT, fitColumnWidths } from './xlsxStyles';

/**
 * Status columns for the Analysis sheet, with Mild/Heavy Flooding combined into "Flooding" and
 * Mild/Heavy Leak combined into "Leak" per explicit client request (2026-07-28). The remaining
 * statuses keep their own columns (unlike the weekly report's coarser grouping).
 */
const ANALYSIS_STATUS_GROUPS: { label: string; statuses: StatusColumn[] }[] = [
  { label: 'Normal', statuses: ['Normal'] },
  { label: 'Flooding', statuses: ['Mild Flooding', 'Heavy Flooding'] },
  { label: 'Leak', statuses: ['Mild Leak', 'Heavy Leak'] },
  { label: 'Choking', statuses: ['Choking'] },
  { label: 'Valve Closed', statuses: ['Valve Closed'] },
  { label: 'No Status', statuses: ['No Status'] },
  { label: 'Offline', statuses: ['Offline'] },
];

/** The Current Status column shows the combined entity, not the Mild/Heavy variant. */
function displayStatus(status: StatusColumn): string {
  if (status === 'Mild Flooding' || status === 'Heavy Flooding') return 'Flooding';
  if (status === 'Mild Leak' || status === 'Heavy Leak') return 'Leak';
  return status;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Converts a share of the analysis window (a percentage) into hh:mm:ss of actual duration, per explicit client request — e.g. 50% of a 24h window -> "12:00:00". */
function formatStatusDuration(pct: number, durationHours: number): string {
  const totalSeconds = Math.round((pct / 100) * durationHours * 3600);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

const HEADERS = [
  'Sr No',
  'Device ID',
  'Location',
  'Department',
  'Current Status',
  'Duration (hrs)',
  ...ANALYSIS_STATUS_GROUPS.map((g) => g.label),
  'Change in Status',
  'Number of Corrective Actions',
  'Number of Feedbacks',
  'Leak Rate',
  'Cost of Steam',
  'Saving',
  'Loss',
];

/**
 * Populates the Daily Report's "Analysis" sheet — one row per device. Leak Rate and Cost of
 * Steam are real (device `properties`, confirmed live); there's no separate "Name" field
 * distinct from Device ID in real data (the source template's short codes like "510-HPST-001"
 * don't exist here), so that column is dropped rather than duplicating Device ID under a
 * different header. Per-status values show TIME SPENT in each status as hh:mm:ss (share of S1
 * readings × the analysis window), not percentages, per explicit client request.
 */
export function buildDailyAnalysisSheet(sheet: Worksheet, rows: DailyAnalysisRow[]): void {
  const LOCATION_COL = HEADERS.indexOf('Location');
  const rowValues = rows.map((row) => {
    const status = classifyStatus(row.currentStatus);
    return [
      row.srNo,
      row.devID,
      row.location,
      row.department,
      displayStatus(status),
      Number(row.durationHours.toFixed(1)),
      ...ANALYSIS_STATUS_GROUPS.map((g) =>
        formatStatusDuration(
          g.statuses.reduce((sum, s) => sum + row.statusPercentages[s], 0),
          row.durationHours,
        ),
      ),
      row.statusChangeCount,
      row.correctiveActionCount,
      row.feedbackCount,
      row.leakRate,
      row.costOfSteam,
      Number(row.steamSaving.toFixed(2)),
      Number(row.steamLoss.toFixed(2)),
    ];
  });

  // Size every column to its widest value (Location can grow further since descriptions are long).
  sheet.columns = fitColumnWidths(HEADERS, rowValues, { min: 12, max: 34, maxByCol: { [LOCATION_COL]: 60 } });
  // Keep the header row visible while scrolling through the device rows, per explicit client request.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const headerRow = sheet.getRow(1);
  headerRow.values = HEADERS;
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.border = ALL_BORDERS;
  });

  rows.forEach((row, i) => {
    const status = classifyStatus(row.currentStatus);
    const excelRow = sheet.getRow(i + 2);
    excelRow.values = rowValues[i];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
      if (status !== 'Normal') cell.font = RED_FONT;
    });
  });
}
