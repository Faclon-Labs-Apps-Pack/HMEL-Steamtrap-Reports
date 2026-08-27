import type { Worksheet } from 'exceljs';
import type { DailyLiveStatusRow } from '../lib/buildDailyReportRows';
import { ALL_BORDERS, BLUE_HEADER_FILL, HEADER_FONT, fitColumnWidths } from './xlsxStyles';

const HEADERS = [
  'Sr No',
  'Tag No',
  'Device ID',
  'Location',
  'Unit',
  'Inlet Pressure (kg/cm²)',
  'Outlet Pressure (kg/cm²)',
  'Inlet BaseLine Temperature (°C)',
  'Outlet BaseLine Temperature (°C)',
  'Live Inlet Temperature (°C)',
  'Live Outlet Temperature (°C)',
  'Status',
];

/**
 * Pressure/temperature values arrive as strings with their unit baked in ("39 kg/cm2 ", "248 °C").
 * The unit now lives in the header, so strip it here and keep only the leading number (blank for
 * "N/A"/no reading) — so the cells are real numbers, not text.
 */
function toNumber(value: string): number | string {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : '';
}

/**
 * Populates the Daily Report's "Live Status" sheet — one row per device, ALL devices together.
 * Pressure and baseline temperature columns are real device `properties` (confirmed live);
 * live temperatures are the latest PT1/PT2 sensor readings. The source template's
 * "Description" column (an auto-generated natural-language explanation of the status) is
 * dropped — there's no confirmed formula/logic for generating that text, and fabricating
 * plausible-sounding explanations would be actively misleading.
 */
export function buildDailyLiveStatusSheet(sheet: Worksheet, rows: DailyLiveStatusRow[]): void {
  const LOCATION_COL = HEADERS.indexOf('Location');
  const rowValues = rows.map((row) => [
    row.srNo,
    row.devName,
    row.devID,
    row.location,
    row.department,
    toNumber(row.inletPressure),
    toNumber(row.outletPressure),
    toNumber(row.baseLineInletTemperature),
    toNumber(row.baseLineOutletTemperature),
    toNumber(row.liveInletTemperature),
    toNumber(row.liveOutletTemperature),
    row.status,
  ]);

  // Size every column to its widest value. Location holds long descriptions, so it's capped tighter
  // and wrapped (below) so all columns stay inside one A3-landscape page width when printed.
  sheet.columns = fitColumnWidths(HEADERS, rowValues, { min: 12, max: 30, maxByCol: { [LOCATION_COL]: 40 } });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const headerRow = sheet.getRow(1);
  headerRow.values = HEADERS;
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.border = ALL_BORDERS;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const LOCATION_CELL = LOCATION_COL + 1; // eachCell colNumber is 1-based
  rowValues.forEach((values, i) => {
    const excelRow = sheet.getRow(i + 2);
    excelRow.values = values;
    excelRow.eachCell((cell, colNumber) => {
      cell.border = ALL_BORDERS;
      if (colNumber === LOCATION_CELL) cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
}
