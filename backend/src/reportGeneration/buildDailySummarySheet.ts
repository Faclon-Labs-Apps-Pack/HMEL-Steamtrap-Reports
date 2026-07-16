import type { Worksheet } from 'exceljs';
import { classifyStatus, STATUS_COLUMNS } from '../lib/statusClassification';
import type { DateRange } from '../lib/dateRange';
import type { Device, LastDataPoint } from '../types/device';
import { ALL_BORDERS, BOLD_FONT, HEADER_FILL, HEADER_FONT } from './xlsxStyles';

/** Hardcoded per explicit request — not derived from device data. */
const HARDCODED_COST_OF_STEAM = '2473';

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Populates the Daily Report's "Summary" sheet: report metadata, an instantaneous status
 * breakdown across ALL devices (no plant-category split — this report doesn't segregate by
 * category, per explicit spec), and aggregate parameters. Cost of Steam is hardcoded (see
 * `HARDCODED_COST_OF_STEAM`) per explicit request, not derived from device data. Loss/Savings
 * (MT/INR) stay "N/A" — the platform's designated sensors for these (D11 "Steam Loss Value",
 * D12 "Steam Saving Value") are defined but read back as 0 for every device regardless of
 * actual leak status (confirmed live 2026-07-16, including on a device currently in Heavy
 * Leak) — they're not actually being computed in this environment, so showing them would be
 * misleading fake zeros.
 */
export function buildDailySummarySheet(
  sheet: Worksheet,
  devices: Device[],
  lastDPs: LastDataPoint[],
  range: DateRange,
  generatedAt: Date,
  correctiveActionTotal: number,
  feedbackTotal: number,
  statusChangeTotal: number,
): void {
  sheet.columns = [{ width: 22 }, { width: 16 }, { width: 18 }];

  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));
  const statusCounts = Object.fromEntries(STATUS_COLUMNS.map((c) => [c, 0])) as Record<string, number>;
  for (const device of devices) {
    statusCounts[classifyStatus(statusByDevID.get(device.devID))] += 1;
  }

  let row = 1;
  const metaRows: [string, string][] = [
    ['Report Name', 'Steam Trap Monitoring System report'],
    ['Report Start Date', formatDate(range.start)],
    ['Report End Date', formatDate(range.end)],
    ['Analysis Duration in Hrs', ((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60)).toFixed(1)],
    ['Report Generated At', formatDate(generatedAt)],
    ['Total Steam traps', String(devices.length)],
  ];
  for (const [label, value] of metaRows) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = BOLD_FONT;
    sheet.getCell(row, 2).value = value;
    row += 1;
  }

  row += 1;
  ['Status', 'Trap Count', '% of Total'].forEach((label, i) => {
    const cell = sheet.getCell(row, 1 + i);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
  });
  row += 1;
  for (const col of STATUS_COLUMNS) {
    sheet.getCell(row, 1).value = col;
    sheet.getCell(row, 2).value = statusCounts[col];
    sheet.getCell(row, 3).value = devices.length > 0 ? `${((statusCounts[col] / devices.length) * 100).toFixed(2)}%` : '0.00%';
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value = 'parameter';
  sheet.getCell(row, 2).value = 'Count';
  sheet.getRow(row).eachCell((cell, col) => {
    if (col <= 2) {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
    }
  });
  row += 1;
  const countRows: [string, number][] = [
    ['Number of feedback', feedbackTotal],
    ['Corrective Actions', correctiveActionTotal],
    ['Status changes', statusChangeTotal],
  ];
  for (const [label, value] of countRows) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = value;
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value = 'parameter';
  sheet.getCell(row, 2).value = 'Numbers';
  sheet.getRow(row).eachCell((cell, col) => {
    if (col <= 2) {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
    }
  });
  row += 1;
  const numberRows: [string, string][] = [
    ['Cost of Steam (Rs/Ton)', HARDCODED_COST_OF_STEAM],
    ['Loss (MT)', 'N/A'],
    ['Savings (MT)', 'N/A'],
    ['Loss (INR)', 'N/A'],
    ['Savings (INR)', 'N/A'],
  ];
  for (const [label, value] of numberRows) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = value;
    row += 1;
  }

  for (let r = 1; r < row; r++) {
    for (let c = 1; c <= 3; c++) {
      const cell = sheet.getCell(r, c);
      if (cell.value !== null && cell.value !== undefined) cell.border = ALL_BORDERS;
    }
  }
}
