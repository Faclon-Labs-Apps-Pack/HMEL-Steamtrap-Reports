import type { Worksheet } from 'exceljs';
import type { DailyLiveStatusRow } from '../lib/buildDailyReportRows';
import { ALL_BORDERS, HEADER_FILL, HEADER_FONT } from './xlsxStyles';

const HEADERS = [
  'Sr No',
  'Device ID',
  'Location',
  'Department',
  'Inlet Pressure',
  'Outlet Pressure',
  'Inlet BaseLine Temperature',
  'Outlet BaseLine Temperature',
  'Live Inlet Temperature',
  'Live Outlet Temperature',
  'Status',
];

/**
 * Populates the Daily Report's "Live Status" sheet — one row per device, ALL devices together.
 * Pressure and baseline temperature columns are real device `properties` (confirmed live);
 * live temperatures are the latest PT1/PT2 sensor readings. The source template's
 * "Description" column (an auto-generated natural-language explanation of the status) is
 * dropped — there's no confirmed formula/logic for generating that text, and fabricating
 * plausible-sounding explanations would be actively misleading.
 */
export function buildDailyLiveStatusSheet(sheet: Worksheet, rows: DailyLiveStatusRow[]): void {
  sheet.columns = HEADERS.map((h) => ({ width: h === 'Location' ? 40 : Math.max(16, h.length + 2) }));

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
      row.inletPressure,
      row.outletPressure,
      row.baseLineInletTemperature,
      row.baseLineOutletTemperature,
      row.liveInletTemperature,
      row.liveOutletTemperature,
      row.status,
    ];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
    });
  });
}
