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
  const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);

  report('Loading device properties…');
  const propertiesByDevID = await getDevicePropertiesByDevice(devices);

  report('Loading steam loss for the range…');
  const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);
  report('Loading steam saving for the range…');
  const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

  report('Assembling per-unit workbooks…');
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

  const reports: DailyUnitReport[] = [];
  for (const unitName of unitNames) {
    const analysisRows = allRows
      .filter((r) => r.department === unitName)
      .map((r, i) => ({ ...r, srNo: i + 1 }));

    const workbook = new Workbook();
    workbook.creator = 'HMEL Steamtrap Reports';
    workbook.created = generatedAt;
    const sheet = workbook.addWorksheet('Analysis');
    buildDailyAnalysisSheet(sheet, analysisRows);
    const title = `Steam Trap Analysis Report–${unitName.trim()}`;
    applyPrintLayout(sheet, { reportDate, title, repeatHeaderRow: 1 });

    const reportName = `${title}-${rangeStamp}`;
    reports.push({
      unitName,
      reportName,
      fileName: `${reportName.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`,
      workbook,
    });
  }
  return reports;
}
