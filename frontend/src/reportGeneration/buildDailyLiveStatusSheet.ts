import type { Worksheet } from 'exceljs';
import type { DailyLiveStatusRow } from '../lib/buildDailyReportRows';
import { ALL_BORDERS, BLUE_HEADER_FILL, HEADER_FONT, fitColumnWidths, estimateHeaderHeight } from './xlsxStyles';

const HEADERS = [
  'Sr No',
  'Unit',
  'Tag No',
  'Type of Steam',
  'Device ID',
  'Location',
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
    row.department,
    row.devName,
    row.steamType,
    row.devID,
    row.location,
    toNumber(row.inletPressure),
    toNumber(row.outletPressure),
    toNumber(row.baseLineInletTemperature),
    toNumber(row.baseLineOutletTemperature),
    toNumber(row.liveInletTemperature),
    toNumber(row.liveOutletTemperature),
    row.status,
  ]);

  // Column widths come from the DATA, not the (often long) headings — short numeric columns stay
  // compact and headings wrap. Location is capped tighter and wraps. Keeps all columns inside one
  // A3-landscape page width.
  sheet.columns = fitColumnWidths(HEADERS, rowValues, {
    min: 5,
    max: 30,
    maxByCol: { [LOCATION_COL]: 40 },
    dataDriven: true,
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const headerRow = sheet.getRow(1);
  headerRow.values = HEADERS;
  headerRow.height = estimateHeaderHeight(HEADERS, sheet.columns as { width: number }[]);
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.border = ALL_BORDERS;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  rowValues.forEach((values, i) => {
    const excelRow = sheet.getRow(i + 2);
    excelRow.values = values;
    // Wrap every cell so long text (Unit / Tag / Device ID / Location) wraps instead of widening the
    // column; row height auto-fits to the wrapped content when the file is opened.
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
}
