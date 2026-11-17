import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackDatesByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice } from '../services/steamConsumptionApi';
import { buildDailyAnalysisRows } from '../lib/buildDailyReportRows';
import { toEpochMs, type DateRange } from '../lib/dateRange';
import { REPORT_TIMEZONE } from '../config';
import { buildDailyAnalysisSheet } from './buildDailyAnalysisSheet';
import { applyPrintLayout, formatReportDate } from './printLayout';
import { filterDevicesByUnit, type DailyUnitReport } from './generateDailyReport';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';

const pad2 = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${pad2(d.getFullYear() % 100)}`;

/**
 * On-demand "Analysis sheet only" report for an ARBITRARY time range — the admin UI's Generate
 * Report tab. Same columns and row pipeline as the scheduled Daily Report's Analysis sheet
 * (status % breakdown, status changes, corrective actions, feedback, leak rate, steam loss/
 * saving), but windowed to the requested range instead of the previous day, and WITHOUT the
 * Summary + Live Status sheets and their heavy WTD/MTD/YTD full-fleet sweeps. The "current
 * status" column still shows the status as of NOW (it's labeled live), same as the daily report.
 *
 * Returns ONE workbook: selecting multiple sections merges all their departments into a single
 * Analysis sheet (client request 2026-11-17) rather than one file per section.
 *
 * Purely a read path: never writes to OUTPUT_DIR, never touches the scheduler or emails.
 */
export async function generateRangeAnalysisWorkbooks(
  range: DateRange,
  opts?: { unitKeys?: string[] },
  onProgress?: (progress: { label: string }) => void,
): Promise<DailyUnitReport[]> {
  const report = (label: string) => onProgress?.({ label });
  const startMs = toEpochMs(range.start);
  const endMs = toEpochMs(range.end);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  const generatedAt = new Date();

  report('Loading devices…');
  const allDevices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);
  const devices = filterDevicesByUnit(allDevices, opts);
  if (devices.length === 0) {
    throw new Error('No steam trap devices matched the selected section(s).');
  }
  const allDevIDs = devices.map((d) => d.devID);

  report(`Loading current status for ${devices.length} devices…`);
  const lastDPs = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));

  report('Loading corrective actions for the range…');
  const caRecords = await getCorrectiveActions(allDevIDs, { startMs, endMs });
  const correctiveActionCountByDevID = new Map<string, number>();
  for (const r of caRecords) {
    const t = new Date(r.dateAndTime).getTime();
    if (t >= startMs && t <= endMs) {
      correctiveActionCountByDevID.set(r.devId, (correctiveActionCountByDevID.get(r.devId) ?? 0) + 1);
    }
  }

  report(`Loading feedback for ${devices.length} devices…`);
  const feedbackDatesByDevID = await getFeedbackDatesByDevice(devices);
  const feedbackCountByDevID = new Map([...feedbackDatesByDevID].map(([id, dates]) => [id, dates.length]));

  report(`Analyzing S1 history over the range for ${devices.length} devices…`);
  const rawStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);
  // On-demand report: the "Change in All Status" total uses the GROUPED, flooding-free change
  // count — the same stream as the per-status breakdown columns — so the total always equals the
  // sum of those columns (the raw-value count double-counted e.g. 1→3, both "Normal").
  const timeSeriesStatsByDevID = new Map(
    [...rawStatsByDevID].map(([id, s]) => [id, { ...s, statusChangeCount: s.groupedChangeCount ?? s.statusChangeCount }]),
  );

  report('Loading device properties…');
  const propertiesByDevID = await getDevicePropertiesByDevice(devices);

  report('Loading steam loss for the range…');
  const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);
  report('Loading steam saving for the range…');
  const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

  report('Assembling the workbook…');
  const allRows = buildDailyAnalysisRows(
    devices,
    lastDPs,
    timeSeriesStatsByDevID,
    correctiveActionCountByDevID,
    feedbackCountByDevID,
    propertiesByDevID,
    steamLossByDevID,
    steamSavingByDevID,
    durationHours,
  );

  const unitNames = [...new Set(allRows.map((r) => r.department))].sort((a, b) => a.localeCompare(b));
  const rangeStamp = `${stamp(range.start)}-to-${stamp(range.end)}`;
  const reportDate = formatReportDate(generatedAt);
  // Stated inside the sheet so every reader knows exactly which window the numbers cover.
  const fmtIST = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: REPORT_TIMEZONE,
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(',', '');
  const periodLabel = `Report data period: ${fmtIST(range.start)} to ${fmtIST(range.end)} (IST)`;

  // ONE workbook, always (client request 2026-11-17): selecting multiple sections used to produce
  // one file per section — now every selected department's rows are MERGED into a single Analysis
  // sheet (rows grouped by unit, continuous Sr No; the Unit column tells departments apart). A
  // single-section selection is simply the one-unit case of the same thing, byte-for-byte what it
  // produced before.
  const mergedLabel =
    unitNames.length <= 3 ? unitNames.map((n) => n.trim()).join(' + ') : `${unitNames.length} Sections`;
  const analysisRows = allRows
    .slice()
    .sort((a, b) => a.department.localeCompare(b.department) || a.devName.localeCompare(b.devName))
    .map((r, i) => ({ ...r, srNo: i + 1 }));

  const workbook = new Workbook();
  workbook.creator = 'HMEL Steamtrap Reports';
  workbook.created = generatedAt;
  const sheet = workbook.addWorksheet('Analysis');
  // On-demand UI report only: show the per-status "Change in <status> status" breakdown columns.
  buildDailyAnalysisSheet(sheet, analysisRows, { includePerStatusChanges: true, periodLabel });
  const title = `Steam Trap Analysis Report–${mergedLabel}`;
  applyPrintLayout(sheet, { reportDate, title, repeatHeaderRow: 2 });

  const reportName = `${title}-${rangeStamp}`;
  return [
    {
      unitName: unitNames.length <= 3 ? mergedLabel : unitNames.join(', '),
      reportName,
      fileName: `${reportName.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`,
      workbook,
    },
  ];
}
