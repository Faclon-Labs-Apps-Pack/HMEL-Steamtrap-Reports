import type { Worksheet } from 'exceljs';
import { STATUS_COLUMNS } from '../lib/statusClassification';
import type { UnitStatusMatrix } from '../lib/segregateByUnit';
import type { CorrectiveActionMatrixData } from '../lib/segregateCorrectiveActions';
import type { DateRange } from '../lib/dateRange';
import { ALL_BORDERS, BOLD_FONT, CENTER, HEADER_FILL, HEADER_FONT, LEFT } from './xlsxStyles';

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
 * Populates one "SteamtrapStatusOverview-<category>" sheet: report metadata, the KPI table
 * (Cost of Steam, Steam Loss, Loss/Savings INR — kept as headers with "N/A" values since none
 * have a defined sensor/formula per the template's own author notes; Overall Trap Health
 * removed per explicit request even though it had a defined formula), the Unit vs Trap Status
 * matrix for that plant category only (INSTANTANEOUS — current status at generation time, not
 * time-windowed), and a second Plant Category/Unit Name table (Corrective Action count + No.
 * of Status changes, both current-week windowed) — this second table lives ~15 rows below the
 * first in the source template and is easy to miss on a quick scan; confirmed present in both
 * overview sheets.
 */
export function buildOverviewSheet(
  sheet: Worksheet,
  plantCategory: 'Refinery' | 'Petchem',
  range: DateRange,
  generatedAt: Date,
  matrix: UnitStatusMatrix,
  correctiveActionMatrix: CorrectiveActionMatrixData,
): void {
  const group = matrix.groups.find((g) => g.plantCategory === plantCategory);
  const totalDevices = group?.subtotalCount ?? 0;
  const caGroup = correctiveActionMatrix.groups.find((g) => g.plantCategory === plantCategory);

  sheet.columns = [
    { width: 18 },
    { width: 22 },
    ...STATUS_COLUMNS.map(() => ({ width: 14 })),
    { width: 10 },
  ];

  let row = 1;

  const metaRows: [string, string][] = [
    ['Report Name', `Steam Trap Monitoring System report - ${plantCategory}`],
    ['Report Start Date', formatDate(range.start)],
    ['Report End Date', formatDate(range.end)],
    ['Analysis Duration in Hrs', ((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60)).toFixed(1)],
    ['Report Generated At', formatDate(generatedAt)],
    ['Total Steam traps', String(totalDevices)],
  ];
  for (const [label, value] of metaRows) {
    const labelCell = sheet.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = BOLD_FONT;
    sheet.getCell(row, 2).value = value;
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value = 'KPI';
  sheet.getCell(row, 2).value = 'Value';
  sheet.getRow(row).font = HEADER_FONT;
  sheet.getRow(row).eachCell((cell, col) => {
    if (col <= 2) cell.fill = HEADER_FILL;
  });
  row += 1;

  const kpiRows: [string, string][] = [
    ['Cost of Steam (Rs)', '2473'], // hardcoded per explicit request — not derived from device data
    ['Steam Loss (MT)', 'N/A'],
    ['Loss (INR)', 'N/A'],
    ['Savings (MT)', 'N/A'],
    ['Savings (INR)', 'N/A'],
  ];
  for (const [label, value] of kpiRows) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = value;
    row += 1;
  }

  row += 1;
  const titleRow = row;
  sheet.mergeCells(titleRow, 1, titleRow, 2);
  const titleCell = sheet.getCell(titleRow, 1);
  titleCell.value = `Unit vs Trap Status (instantaneous, at report generation time ${formatDate(generatedAt)})`;
  titleCell.font = HEADER_FONT;
  titleCell.fill = HEADER_FILL;
  titleCell.alignment = CENTER;

  STATUS_COLUMNS.forEach((col, i) => {
    const cell = sheet.getCell(titleRow, 3 + i);
    cell.value = col;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = CENTER;
    sheet.mergeCells(titleRow, 3 + i, titleRow + 1, 3 + i);
  });
  const totalHeaderCell = sheet.getCell(titleRow, 3 + STATUS_COLUMNS.length);
  totalHeaderCell.value = 'Total';
  totalHeaderCell.font = HEADER_FONT;
  totalHeaderCell.fill = HEADER_FILL;
  totalHeaderCell.alignment = CENTER;
  sheet.mergeCells(titleRow, 3 + STATUS_COLUMNS.length, titleRow + 1, 3 + STATUS_COLUMNS.length);

  const subHeaderRow = titleRow + 1;
  const plantCell = sheet.getCell(subHeaderRow, 1);
  plantCell.value = 'Plant Category';
  plantCell.font = HEADER_FONT;
  plantCell.fill = HEADER_FILL;
  const unitCell = sheet.getCell(subHeaderRow, 2);
  unitCell.value = 'Unit Name';
  unitCell.font = HEADER_FONT;
  unitCell.fill = HEADER_FILL;

  row = subHeaderRow + 1;
  const units = group?.units ?? [];
  const firstDataRow = row;
  for (const unit of units) {
    sheet.getCell(row, 2).value = unit.unitName;
    STATUS_COLUMNS.forEach((col, i) => {
      sheet.getCell(row, 3 + i).value = unit.counts[col];
    });
    sheet.getCell(row, 3 + STATUS_COLUMNS.length).value = unit.total;
    row += 1;
  }
  if (units.length > 0) {
    sheet.mergeCells(firstDataRow, 1, row - 1, 1);
    sheet.getCell(firstDataRow, 1).value = plantCategory;
    sheet.getCell(firstDataRow, 1).alignment = LEFT;
  }

  const totalRow = row;
  sheet.mergeCells(totalRow, 1, totalRow, 2);
  const totalLabelCell = sheet.getCell(totalRow, 1);
  totalLabelCell.value = 'Total';
  totalLabelCell.font = BOLD_FONT;
  STATUS_COLUMNS.forEach((col, i) => {
    const cell = sheet.getCell(totalRow, 3 + i);
    cell.value = group?.subtotal[col] ?? 0;
    cell.font = BOLD_FONT;
  });
  const totalCell = sheet.getCell(totalRow, 3 + STATUS_COLUMNS.length);
  totalCell.value = totalDevices;
  totalCell.font = BOLD_FONT;

  const lastCol = 3 + STATUS_COLUMNS.length;
  for (let r = titleRow; r <= totalRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      sheet.getCell(r, c).border = ALL_BORDERS;
    }
  }

  // Second table: Corrective Action count + No. of Status changes, current-week windowed.
  row = totalRow + 2;
  const caHeaderRow = row;
  ['Plant Category', 'Unit Name', 'Corrective Action', 'No. of Status changes'].forEach((label, i) => {
    const cell = sheet.getCell(caHeaderRow, 1 + i);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = CENTER;
  });
  row += 1;

  const caUnits = caGroup?.units ?? [];
  const caFirstDataRow = row;
  for (const unit of caUnits) {
    sheet.getCell(row, 2).value = unit.unitName;
    sheet.getCell(row, 3).value = unit.correctiveActionCount;
    sheet.getCell(row, 4).value = unit.statusChangeCount;
    row += 1;
  }
  if (caUnits.length > 0) {
    sheet.mergeCells(caFirstDataRow, 1, row - 1, 1);
    sheet.getCell(caFirstDataRow, 1).value = plantCategory;
    sheet.getCell(caFirstDataRow, 1).alignment = LEFT;
  }

  const caTotalRow = row;
  sheet.mergeCells(caTotalRow, 1, caTotalRow, 2);
  const caTotalLabelCell = sheet.getCell(caTotalRow, 1);
  caTotalLabelCell.value = 'Total';
  caTotalLabelCell.font = BOLD_FONT;
  const caTotalActionsCell = sheet.getCell(caTotalRow, 3);
  caTotalActionsCell.value = caGroup?.subtotalCorrectiveActions ?? 0;
  caTotalActionsCell.font = BOLD_FONT;
  const caTotalChangesCell = sheet.getCell(caTotalRow, 4);
  caTotalChangesCell.value = caGroup?.subtotalStatusChanges ?? 0;
  caTotalChangesCell.font = BOLD_FONT;

  for (let r = caHeaderRow; r <= caTotalRow; r++) {
    for (let c = 1; c <= 4; c++) {
      sheet.getCell(r, c).border = ALL_BORDERS;
    }
  }
}
