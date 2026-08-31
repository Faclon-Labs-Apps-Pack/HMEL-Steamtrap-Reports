import type { Worksheet } from 'exceljs';
import { classifyStatus, type StatusColumn } from '../lib/statusClassification';
import type { DateRange } from '../lib/dateRange';
import type { Device, LastDataPoint } from '../types/device';
import { ALL_BORDERS, BLUE_HEADER_FILL, BOLD_FONT, CENTER, HEADER_FONT, LEFT } from './xlsxStyles';
import { HMEL_LOGO_DAILY_SIZE } from './hmelLogo';
import { addLogoHeader } from './printLayout';

/** Hardcoded per explicit request — not derived from device data. */
const HARDCODED_COST_OF_STEAM = 2473;

/**
 * The metrics behind one column (WTD / MTD / YTD) of the Performance Indicators and Maintenance
 * Log tables. DTD is not passed as one of these — it stays computed inside the sheet from the
 * scalar params, exactly as before, so the DTD column is unchanged.
 */
export interface SummaryWindowValues {
  /** Overall Trap Health over the window, as a percentage 0-100. */
  trapHealthPct: number;
  steamLossMT: number;
  steamSavingMT: number;
  statusChanges: number;
  correctiveActions: number;
  feedback: number;
}

export interface SummaryPeriodWindows {
  wtd: SummaryWindowValues;
  mtd: SummaryWindowValues;
  ytd: SummaryWindowValues;
}

/**
 * Status buckets for the Summary sheet's "Steam Trap Status" table, per the client's mock
 * (2026-07-29): Leak/Flooding combine their Mild/Heavy variants, Choking shows as "Choked",
 * and Valve Closed shows as "Isolated" (a deliberately isolated trap).
 */
const SUMMARY_STATUS_GROUPS: { label: string; statuses: StatusColumn[] }[] = [
  { label: 'Normal', statuses: ['Normal'] },
  { label: 'Leak', statuses: ['Mild Leak', 'Heavy Leak'] },
  { label: 'Choked', statuses: ['Choking'] },
  { label: 'Flooding', statuses: ['Mild Flooding', 'Heavy Flooding'] },
  { label: 'Isolated', statuses: ['Valve Closed'] },
  { label: 'No Status', statuses: ['No Status'] },
  { label: 'Offline', statuses: ['Offline'] },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Client-specified format: DD-MMM-YY HH:MM:SS (e.g. 26-Jul-26 23:59:59). */
function formatDate(d: Date): string {
  return `${pad2(d.getDate())}-${MONTH_ABBR[d.getMonth()]}-${pad2(d.getFullYear() % 100)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Populates the Daily Report's "Summary" sheet per the client's mock (2026-07-29):
 * a title block ("Steam Traps Health Monitoring / Daily Report") with the HMEL logo,
 * Plant/Unit/No. of Traps/Period/Generation Time metadata, the instantaneous status table
 * (grouped buckets + Total row), then Performance Indicators and Maintenance Log tables with
 * DTD | WTD | MTD | YTD columns — only DTD is populated (plus the constant Rate of Steam,
 * merged across all four windows), exactly like the mock.
 */
export function buildDailySummarySheet(
  sheet: Worksheet,
  unitName: string,
  plantCategory: string,
  devices: Device[],
  lastDPs: LastDataPoint[],
  range: DateRange,
  generatedAt: Date,
  correctiveActionTotal: number,
  feedbackTotal: number,
  statusChangeTotal: number,
  steamLossMT: number,
  steamSavingMT: number,
  periods: SummaryPeriodWindows,
  logoImageId: number,
): void {
  sheet.columns = [{ width: 26 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 16 }];

  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));
  const statusCounts = Object.fromEntries(
    SUMMARY_STATUS_GROUPS.map((g) => [g.label, 0]),
  ) as Record<string, number>;
  for (const device of devices) {
    const status = classifyStatus(statusByDevID.get(device.devID));
    const group = SUMMARY_STATUS_GROUPS.find((g) => g.statuses.includes(status));
    if (group) statusCounts[group.label] += 1;
  }
  const totalDevices = devices.length;

  // --- Title block: logo on the left (constrained to header rows 1–2 — see addLogoHeader),
  // two-line report title across the rest.
  addLogoHeader(sheet, logoImageId, HMEL_LOGO_DAILY_SIZE, 'A1:A2');
  sheet.mergeCells('B1:E2');
  const titleCell = sheet.getCell('B1');
  titleCell.value = 'Steam Traps Health Monitoring\nDaily Report';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  // Title band is blue like the table headers (per the client mock); the logo cell stays white.
  titleCell.fill = BLUE_HEADER_FILL;
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }

  // --- Metadata rows.
  let row = 3;
  const metaLabel = (r: number, label: string) => {
    const cell = sheet.getCell(r, 1);
    cell.value = label;
    cell.font = BOLD_FONT;
    cell.fill = BLUE_HEADER_FILL;
  };
  // Each value spans B:E (left-aligned) so long dates get the full width and aren't clipped by a
  // neighbouring cell — the Period is one string ("start … to … end") for the same reason.
  const metaValue = (r: number, value: string | number) => {
    sheet.mergeCells(r, 2, r, 5);
    const cell = sheet.getCell(r, 2);
    cell.value = value;
    cell.alignment = LEFT;
  };
  metaLabel(row, 'Plant :');
  metaValue(row, plantCategory);
  row += 1;
  metaLabel(row, 'Unit :');
  metaValue(row, unitName);
  row += 1;
  metaLabel(row, 'No. of Steam Traps :');
  metaValue(row, totalDevices);
  row += 1;
  metaLabel(row, 'Period :');
  metaValue(row, `${formatDate(range.start)} Hrs   to   ${formatDate(range.end)} Hrs`);
  row += 1;
  metaLabel(row, 'Generation Time:');
  metaValue(row, `${formatDate(generatedAt)} Hrs`);
  for (let r = 3; r <= row; r++) {
    for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }

  // --- Steam Trap Status table.
  row += 2;
  const statusTitleRow = row;
  sheet.mergeCells(statusTitleRow, 1, statusTitleRow, 5);
  const statusTitle = sheet.getCell(statusTitleRow, 1);
  statusTitle.value = `Steam Trap Status at ${formatDate(range.end)}`;
  statusTitle.font = HEADER_FONT;
  statusTitle.fill = BLUE_HEADER_FILL;
  statusTitle.alignment = CENTER;
  row += 1;

  const statusHeaderRow = row;
  const statusHeader = (col: number, span: number, label: string) => {
    if (span > 1) sheet.mergeCells(statusHeaderRow, col, statusHeaderRow, col + span - 1);
    const cell = sheet.getCell(statusHeaderRow, col);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.alignment = CENTER;
  };
  statusHeader(1, 1, 'Trap Status');
  statusHeader(2, 2, 'No. of Traps');
  statusHeader(4, 2, 'Percentage');
  row += 1;

  for (const group of SUMMARY_STATUS_GROUPS) {
    sheet.getCell(row, 1).value = group.label;
    sheet.mergeCells(row, 2, row, 3);
    const countCell = sheet.getCell(row, 2);
    countCell.value = statusCounts[group.label];
    countCell.alignment = CENTER;
    sheet.mergeCells(row, 4, row, 5);
    const pctCell = sheet.getCell(row, 4);
    // Real number (a fraction) + a percent number-format, NOT a "0.00%" string — so Excel treats
    // it as a number (no "number stored as text" warning) and it stays summable.
    pctCell.value = totalDevices > 0 ? statusCounts[group.label] / totalDevices : 0;
    pctCell.numFmt = '0.00%';
    pctCell.alignment = CENTER;
    row += 1;
  }
  const statusTotalRow = row;
  sheet.getCell(statusTotalRow, 1).value = 'Total';
  sheet.getCell(statusTotalRow, 1).font = BOLD_FONT;
  sheet.mergeCells(statusTotalRow, 2, statusTotalRow, 3);
  const totalCountCell = sheet.getCell(statusTotalRow, 2);
  totalCountCell.value = totalDevices;
  totalCountCell.font = BOLD_FONT;
  totalCountCell.alignment = CENTER;
  sheet.mergeCells(statusTotalRow, 4, statusTotalRow, 5);
  const totalPctCell = sheet.getCell(statusTotalRow, 4);
  totalPctCell.value = totalDevices > 0 ? 1 : 0;
  totalPctCell.numFmt = '0%';
  totalPctCell.font = BOLD_FONT;
  totalPctCell.alignment = CENTER;
  for (let r = statusTitleRow; r <= statusTotalRow; r++) {
    for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }
  row += 1;

  // --- Performance Indicators table. DTD is populated; WTD/MTD/YTD stay blank per the mock.
  row += 1;
  const perfHeaderRow = row;
  ['Performance Indicators', 'DTD', 'WTD', 'MTD', 'YTD'].forEach((label, i) => {
    const cell = sheet.getCell(perfHeaderRow, 1 + i);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    if (i > 0) cell.alignment = CENTER;
  });
  row += 1;

  // Each value is a real NUMBER with a number-format (percent / MT / INR), never a preformatted
  // string — so Excel doesn't flag "number stored as text" and the columns stay summable.
  // Trap health is stored as a fraction (0-1) because the '0.0%' format multiplies by 100.
  const fourColNum = (r: number, label: string, values: [number, number, number, number], numFmt: string) => {
    sheet.getCell(r, 1).value = label;
    values.forEach((v, i) => {
      const cell = sheet.getCell(r, 2 + i);
      cell.value = v;
      cell.numFmt = numFmt;
      cell.alignment = CENTER;
    });
  };
  const healthDTD = totalDevices > 0 ? statusCounts.Normal / totalDevices : 0;
  fourColNum(
    row,
    'Overall Trap Health',
    [healthDTD, periods.wtd.trapHealthPct / 100, periods.mtd.trapHealthPct / 100, periods.ytd.trapHealthPct / 100],
    '0.0%',
  );
  row += 1;
  // Rate of steam is a constant, shown once across all four windows.
  sheet.getCell(row, 1).value = 'Rate of Steam (INR/MT)';
  sheet.mergeCells(row, 2, row, 5);
  const rateCell = sheet.getCell(row, 2);
  rateCell.value = HARDCODED_COST_OF_STEAM;
  rateCell.numFmt = '#,##0';
  rateCell.alignment = CENTER;
  row += 1;
  fourColNum(
    row,
    'Steam Loss (MT)',
    [steamLossMT, periods.wtd.steamLossMT, periods.mtd.steamLossMT, periods.ytd.steamLossMT],
    '0.00',
  );
  row += 1;
  fourColNum(
    row,
    'Steam Savings (MT)',
    [steamSavingMT, periods.wtd.steamSavingMT, periods.mtd.steamSavingMT, periods.ytd.steamSavingMT],
    '0.00',
  );
  row += 1;
  const cost = HARDCODED_COST_OF_STEAM;
  fourColNum(
    row,
    'Loss (INR)',
    [steamLossMT * cost, periods.wtd.steamLossMT * cost, periods.mtd.steamLossMT * cost, periods.ytd.steamLossMT * cost],
    '#,##0',
  );
  row += 1;
  fourColNum(
    row,
    'Savings (INR)',
    [steamSavingMT * cost, periods.wtd.steamSavingMT * cost, periods.mtd.steamSavingMT * cost, periods.ytd.steamSavingMT * cost],
    '#,##0',
  );
  for (let r = perfHeaderRow; r <= row; r++) {
    for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }
  row += 1;

  // --- Maintenance Log table. DTD populated; WTD/MTD/YTD stay blank per the mock.
  row += 1;
  const maintHeaderRow = row;
  ['Maintenance Log', 'DTD', 'WTD', 'MTD', 'YTD'].forEach((label, i) => {
    const cell = sheet.getCell(maintHeaderRow, 1 + i);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    if (i > 0) cell.alignment = CENTER;
  });
  row += 1;

  const maintRows: [string, [number, number, number, number]][] = [
    ['Status changes', [statusChangeTotal, periods.wtd.statusChanges, periods.mtd.statusChanges, periods.ytd.statusChanges]],
    ['Corrective Actions', [correctiveActionTotal, periods.wtd.correctiveActions, periods.mtd.correctiveActions, periods.ytd.correctiveActions]],
    ['Number of feedback', [feedbackTotal, periods.wtd.feedback, periods.mtd.feedback, periods.ytd.feedback]],
  ];
  for (const [label, values] of maintRows) {
    sheet.getCell(row, 1).value = label;
    values.forEach((v, i) => {
      const cell = sheet.getCell(row, 2 + i);
      cell.value = v;
      cell.alignment = CENTER;
    });
    row += 1;
  }
  for (let r = maintHeaderRow; r < row; r++) {
    for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }
}
