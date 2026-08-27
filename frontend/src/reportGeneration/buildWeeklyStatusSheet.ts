import type { Worksheet } from 'exceljs';
import type { StatusColumn } from '../lib/statusClassification';
import type { DateRange } from '../lib/dateRange';
import { ALL_BORDERS, BLUE_HEADER_FILL, BOLD_FONT, CENTER, LEFT } from './xlsxStyles';
import { HMEL_LOGO_WEEKLY_SIZE } from './hmelLogo';

/** Hardcoded per explicit request — matches the "Rate of Steam" row shown in the client template. */
const HARDCODED_COST_OF_STEAM = 2473;

/**
 * Grouped status columns for the weekly report's Steam Trap Status table, in the client
 * reference's exact order/names ("Steam Trap Weekly Report-Refinery 26-07-2026.xlsx"):
 * Normal | Leak | Choked | Flooding | Isolated | No status | Offline. Mild/Heavy variants fold
 * together; Choking → "Choked", Valve Closed → "Isolated".
 */
export const WEEKLY_STATUS_GROUPS: { label: string; statuses: StatusColumn[] }[] = [
  { label: 'Normal', statuses: ['Normal'] },
  { label: 'Leak', statuses: ['Mild Leak', 'Heavy Leak'] },
  { label: 'Choked', statuses: ['Choking'] },
  { label: 'Flooding', statuses: ['Mild Flooding', 'Heavy Flooding'] },
  { label: 'Isolated', statuses: ['Valve Closed'] },
  { label: 'No status', statuses: ['No Status'] },
  { label: 'Offline', statuses: ['Offline'] },
];

/** One KPI window's figures (Steam Loss/Savings in MT; trap health as a percentage 0-100). */
export interface WeeklyKpiWindow {
  trapHealthPct: number;
  steamLossMT: number;
  steamSavingMT: number;
}

export interface WeeklyPerfWindows {
  wtd: WeeklyKpiWindow;
  mtd: WeeklyKpiWindow;
  ytd: WeeklyKpiWindow;
}

/** Instantaneous grouped status counts for one unit (keyed by WEEKLY_STATUS_GROUPS label). */
export interface WeeklyUnitStatusRow {
  unitName: string;
  counts: Record<string, number>;
  total: number;
}

/** Corrective-action counts for one unit across the three windows. */
export interface WeeklyUnitCARow {
  unitName: string;
  wtd: number;
  mtd: number;
  ytd: number;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** DD-MMM-YY HH:MM:SS, e.g. 26-Jul-26 23:59:59. */
function formatDate(d: Date): string {
  return `${pad2(d.getDate())}-${MONTH_ABBR[d.getMonth()]}-${pad2(d.getFullYear() % 100)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const NUM_COLS = 10; // A..J — data starts at column A (no left gutter)

/**
 * Populates one weekly "Steam Trap Status-<Category>" sheet, matching the client reference
 * ("Steam Trap Weekly Report-Refinery 26-07-2026.xlsx"): a title block with the HMEL logo,
 * Period/Generation-Time rows, a Performance Indicators table (WTD | MTD | YTD), the Steam
 * Trap Status table with one row per unit in the category (grouped status columns + Total),
 * and a Corrective Action table with one row per unit (WTD | MTD | YTD + Total).
 */
export function buildWeeklyStatusSheet(
  sheet: Worksheet,
  categoryName: string,
  range: DateRange,
  generatedAt: Date,
  perf: WeeklyPerfWindows,
  statusRows: WeeklyUnitStatusRow[],
  caRows: WeeklyUnitCARow[],
  logoImageId: number,
): void {
  // Data starts at column A (no left gutter): A = Sr.No/labels; B = Unit Name; C..I = 7 status
  // columns; J = Total. A and C are a bit wider so Sr.No/labels and the first status/date column
  // read comfortably.
  sheet.columns = [
    { width: 12 },
    { width: 16 },
    { width: 15 },
    ...Array.from({ length: 6 }, () => ({ width: 10 })),
    { width: 9 },
  ];

  const box = (r1: number, r2: number, c1 = 1, c2 = NUM_COLS) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  };
  const header = (r: number, c1: number, c2: number, value: string, align: 'center' | 'left' = 'center') => {
    if (c2 > c1) sheet.mergeCells(r, c1, r, c2);
    const cell = sheet.getCell(r, c1);
    cell.value = value;
    cell.font = { bold: true };
    cell.fill = BLUE_HEADER_FILL;
    cell.alignment = align === 'center' ? CENTER : LEFT;
  };
  const dataCell = (r: number, c1: number, c2: number, value: string | number, bold = false) => {
    if (c2 > c1) sheet.mergeCells(r, c1, r, c2);
    const cell = sheet.getCell(r, c1);
    cell.value = value;
    cell.alignment = CENTER;
    if (bold) cell.font = BOLD_FONT;
  };

  // --- Title block (rows 1-2), laid out like the Daily report: the HMEL logo in a wide, white
  // A1:B2 cell (its PNG has a white background, so it blends) and the two-line title across
  // C1:J2 on the blue band.
  sheet.getRow(1).height = 26;
  sheet.getRow(2).height = 26;
  sheet.mergeCells('C1:J2');
  const title = sheet.getCell('C1');
  title.value = `${categoryName} Steam Traps Health Monitoring\nWeekly Report`;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  title.fill = BLUE_HEADER_FILL;
  sheet.mergeCells('A1:B2');
  // The logo image is a cell-sized white canvas with the HMEL mark centered on it, anchored to
  // fill A1:B2 — so the mark reads as centered (ExcelJS's per-cell offset can't center reliably).
  sheet.addImage(logoImageId, { tl: { col: 0, row: 0 }, ext: HMEL_LOGO_WEEKLY_SIZE });
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= NUM_COLS; c++) sheet.getCell(r, c).border = ALL_BORDERS;
  }

  // --- Period / Generation Time.
  header(3, 1, 2, 'Period :', 'left');
  dataCell(3, 3, 4, `${formatDate(range.start)} Hrs`);
  dataCell(3, 5, 5, 'to');
  dataCell(3, 6, 8, `${formatDate(range.end)} Hrs`);
  header(4, 1, 2, 'Generation Time:', 'left');
  dataCell(4, 3, 4, `${formatDate(generatedAt)} Hrs`);
  box(3, 4);

  // --- Performance Indicators (WTD | MTD | YTD).
  const perfHeaderRow = 6;
  header(perfHeaderRow, 1, 3, 'Performance Indicators', 'left');
  header(perfHeaderRow, 4, 5, 'WTD');
  header(perfHeaderRow, 6, 8, 'MTD');
  header(perfHeaderRow, 9, 10, 'YTD');

  const cost = HARDCODED_COST_OF_STEAM;
  // Each WTD/MTD/YTD value is a real NUMBER with a number-format (percent / MT / INR), never a
  // preformatted string — so Excel doesn't flag "number stored as text" and columns stay
  // summable. Trap health is stored as a fraction (0-1) because the '0.0%' format ×100 on display.
  const perfRow = (r: number, label: string, w: number, m: number, y: number, numFmt: string) => {
    header(r, 1, 3, label, 'left');
    (sheet.getCell(r, 1).font = { bold: false }); // labels here are not bold in the reference
    (sheet.getCell(r, 1).fill = { type: 'pattern', pattern: 'none' });
    const put = (c1: number, c2: number, v: number) => {
      dataCell(r, c1, c2, v);
      sheet.getCell(r, c1).numFmt = numFmt;
    };
    put(4, 5, w);
    put(6, 8, m);
    put(9, 10, y);
  };
  perfRow(7, 'Overall Trap Health', perf.wtd.trapHealthPct / 100, perf.mtd.trapHealthPct / 100, perf.ytd.trapHealthPct / 100, '0.0%');
  // Rate of steam: one constant value spanning all three windows.
  header(8, 1, 3, 'Rate of Steam (INR/MT)', 'left');
  sheet.getCell(8, 1).font = { bold: false };
  sheet.getCell(8, 1).fill = { type: 'pattern', pattern: 'none' };
  dataCell(8, 4, 10, cost);
  sheet.getCell(8, 4).numFmt = '#,##0';
  perfRow(9, 'Steam Loss (MT)', perf.wtd.steamLossMT, perf.mtd.steamLossMT, perf.ytd.steamLossMT, '0.00');
  perfRow(10, 'Steam Savings (MT)', perf.wtd.steamSavingMT, perf.mtd.steamSavingMT, perf.ytd.steamSavingMT, '0.00');
  perfRow(11, 'Loss (INR)', perf.wtd.steamLossMT * cost, perf.mtd.steamLossMT * cost, perf.ytd.steamLossMT * cost, '#,##0');
  perfRow(12, 'Savings (INR)', perf.wtd.steamSavingMT * cost, perf.mtd.steamSavingMT * cost, perf.ytd.steamSavingMT * cost, '#,##0');
  box(perfHeaderRow, 12);

  // --- Steam Trap Status table.
  const statusTitleRow = 14;
  header(statusTitleRow, 1, NUM_COLS, `Steam Trap Status at ${formatDate(range.end)}`);
  const statusHeaderRow = statusTitleRow + 1; // 15
  header(statusHeaderRow, 1, 1, 'Sr. No.');
  header(statusHeaderRow, 2, 2, 'Unit Name');
  WEEKLY_STATUS_GROUPS.forEach((g, i) => header(statusHeaderRow, 3 + i, 3 + i, g.label));
  header(statusHeaderRow, 3 + WEEKLY_STATUS_GROUPS.length, 3 + WEEKLY_STATUS_GROUPS.length, 'Total');

  let row = statusHeaderRow + 1;
  const totals = Object.fromEntries(WEEKLY_STATUS_GROUPS.map((g) => [g.label, 0])) as Record<string, number>;
  let grandTotal = 0;
  statusRows.forEach((u, i) => {
    dataCell(row, 1, 1, i + 1);
    sheet.getCell(row, 2).value = u.unitName;
    sheet.getCell(row, 2).alignment = CENTER;
    WEEKLY_STATUS_GROUPS.forEach((g, gi) => {
      dataCell(row, 3 + gi, 3 + gi, u.counts[g.label] ?? 0);
      totals[g.label] += u.counts[g.label] ?? 0;
    });
    dataCell(row, 3 + WEEKLY_STATUS_GROUPS.length, 3 + WEEKLY_STATUS_GROUPS.length, u.total);
    grandTotal += u.total;
    row += 1;
  });
  const statusTotalRow = row;
  header(statusTotalRow, 1, 2, 'Total');
  WEEKLY_STATUS_GROUPS.forEach((g, gi) => {
    const cell = sheet.getCell(statusTotalRow, 3 + gi);
    cell.value = totals[g.label];
    cell.font = BOLD_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.alignment = CENTER;
  });
  const gtCell = sheet.getCell(statusTotalRow, 3 + WEEKLY_STATUS_GROUPS.length);
  gtCell.value = grandTotal;
  gtCell.font = BOLD_FONT;
  gtCell.fill = BLUE_HEADER_FILL;
  gtCell.alignment = CENTER;
  box(statusTitleRow, statusTotalRow);

  // --- Corrective Action table (per unit, WTD | MTD | YTD).
  row = statusTotalRow + 2;
  const caHeaderRow = row;
  sheet.mergeCells(caHeaderRow, 1, caHeaderRow + 1, 1);
  header(caHeaderRow, 1, 1, 'Sr. No.');
  sheet.mergeCells(caHeaderRow, 2, caHeaderRow + 1, 2);
  header(caHeaderRow, 2, 2, 'Unit Name');
  header(caHeaderRow, 3, NUM_COLS, 'Corrective Action');
  const caSubRow = caHeaderRow + 1;
  header(caSubRow, 3, 5, 'WTD');
  header(caSubRow, 6, 8, 'MTD');
  header(caSubRow, 9, 10, 'YTD');

  row = caSubRow + 1;
  let caWtdTotal = 0;
  let caMtdTotal = 0;
  let caYtdTotal = 0;
  caRows.forEach((u, i) => {
    dataCell(row, 1, 1, i + 1);
    sheet.getCell(row, 2).value = u.unitName;
    sheet.getCell(row, 2).alignment = CENTER;
    dataCell(row, 3, 5, u.wtd);
    dataCell(row, 6, 8, u.mtd);
    dataCell(row, 9, 10, u.ytd);
    caWtdTotal += u.wtd;
    caMtdTotal += u.mtd;
    caYtdTotal += u.ytd;
    row += 1;
  });
  const caTotalRow = row;
  header(caTotalRow, 1, 2, 'Total');
  dataCell(caTotalRow, 3, 5, caWtdTotal, true);
  dataCell(caTotalRow, 6, 8, caMtdTotal, true);
  dataCell(caTotalRow, 9, 10, caYtdTotal, true);
  sheet.getCell(caTotalRow, 3).fill = BLUE_HEADER_FILL;
  sheet.getCell(caTotalRow, 6).fill = BLUE_HEADER_FILL;
  sheet.getCell(caTotalRow, 9).fill = BLUE_HEADER_FILL;
  box(caHeaderRow, caTotalRow);
}
