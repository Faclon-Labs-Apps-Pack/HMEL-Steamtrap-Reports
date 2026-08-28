import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof Workbook>;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions, type CorrectiveActionRecord } from '../services/correctiveActionApi';
import { getFeedbackDatesByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice, type DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice, getSteamConsumptionTotal } from '../services/steamConsumptionApi';
import { buildDailyAnalysisRows, buildDailyLiveStatusRows } from '../lib/buildDailyReportRows';
import {
  getTodayRange,
  getTrailing7DayRange,
  getMonthToDateRange,
  getFinancialYearToDateRange,
  normalizeDateRange,
  toEpochMs,
  type DateRange,
} from '../lib/dateRange';
import { extractDepartmentFromTags } from '../lib/departmentTag';
import { derivePlantCategory, UNASSIGNED } from '../lib/plantCategory';
import { envKey } from '../config';
import { dailyReportFileName, dailyReportName } from '../lib/reportNaming';
import { HMEL_LOGO_DAILY_BASE64 } from './hmelLogo';
import { buildDailySummarySheet, type SummaryWindowValues } from './buildDailySummarySheet';
import { buildDailyAnalysisSheet } from './buildDailyAnalysisSheet';
import { buildDailyLiveStatusSheet } from './buildDailyLiveStatusSheet';
import { applyPrintLayout, applySummaryPrintLayout, formatReportDate } from './printLayout';
import type { Device } from '../types/device';

/** Restrict a device list to specific units (by env-key) — includes `unitKeys`, or all except `excludeUnitKeys`. */
function filterDevicesByUnit(devices: Device[], opts?: { unitKeys?: string[]; excludeUnitKeys?: string[] }): Device[] {
  if (opts?.unitKeys) {
    const keep = new Set(opts.unitKeys);
    return devices.filter((d) => keep.has(envKey(extractDepartmentFromTags(d.tags) ?? UNASSIGNED)));
  }
  if (opts?.excludeUnitKeys && opts.excludeUnitKeys.length > 0) {
    const drop = new Set(opts.excludeUnitKeys);
    return devices.filter((d) => !drop.has(envKey(extractDepartmentFromTags(d.tags) ?? UNASSIGNED)));
  }
  return devices;
}

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const INLET_TEMP_SENSOR = 'PT1';
const OUTLET_TEMP_SENSOR = 'PT2';
const STEAM_LOSS_SENSOR = 'D11';
const STEAM_SAVING_SENSOR = 'D12';

/** Sum of a corrective-action record set, filtered to a window by `dateAndTime`, counted per device. */
function countCorrectiveActionsInWindow(records: CorrectiveActionRecord[], startMs: number, endMs: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const t = new Date(r.dateAndTime).getTime();
    if (t >= startMs && t <= endMs) counts.set(r.devId, (counts.get(r.devId) ?? 0) + 1);
  }
  return counts;
}

/** Overall Trap Health of a device set over a window: average share of S1 readings classified Normal (a device with no readings counts as 0%). */
function unitHealthPct(unitDevices: Device[], stats: Map<string, DeviceTimeSeriesStats>): number {
  if (unitDevices.length === 0) return 0;
  const sum = unitDevices.reduce((s, d) => s + (stats.get(d.devID)?.statusPercentages.Normal ?? 0), 0);
  return sum / unitDevices.length;
}

function unitStatusChanges(unitDevices: Device[], stats: Map<string, DeviceTimeSeriesStats>): number {
  return unitDevices.reduce((s, d) => s + (stats.get(d.devID)?.statusChangeCount ?? 0), 0);
}

function sumForDevices(devIDs: string[], countByDevID: Map<string, number>): number {
  return devIDs.reduce((s, id) => s + (countByDevID.get(id) ?? 0), 0);
}

/** Feedback records (createdAt epochs per device) counted within a window, for the given devices. */
function countFeedbackInWindow(unitDevices: Device[], datesByDevID: Map<string, number[]>, startMs: number, endMs: number): number {
  return unitDevices.reduce(
    (s, d) => s + (datesByDevID.get(d.devID) ?? []).filter((t) => t >= startMs && t <= endMs).length,
    0,
  );
}

export interface DailyReportProgress {
  label: string;
}

export interface DailyUnitReport {
  unitName: string;
  /** e.g. 'Steam Trap Daily Report–Petchem Offsite-28/07/26' — also the email subject. */
  reportName: string;
  fileName: string;
  workbook: Workbook;
}

/**
 * Builds one 3-sheet Daily Report workbook (Summary, Analysis, Live Status) PER UNIT — a unit
 * being the device's "department:<value>" tag, the same grouping the Management Report calls
 * Unit Name. Per explicit client request (2026-07-28) each unit gets its own file, named after
 * the unit. Data is fetched once for all devices, then split. Windowed to TODAY (not current
 * week) since this is a daily report, matching its name and the source template's own 24hr
 * duration.
 */
export async function generateDailyReportWorkbooks(
  onProgress?: (progress: DailyReportProgress) => void,
  opts?: { unitKeys?: string[]; excludeUnitKeys?: string[]; fast?: boolean },
): Promise<DailyUnitReport[]> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const allDevices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);
  // The scheduler can restrict generation to specific units (or all-but-some) so each unit can be
  // scheduled at its own time — filter here so every downstream fetch is scoped to those units.
  const devices = filterDevicesByUnit(allDevices, opts);

  const range = normalizeDateRange(getTodayRange());
  const startMs = toEpochMs(range.start);
  const endMs = toEpochMs(range.end);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  const generatedAt = new Date();

  report(`Loading current status + live temperatures for ${devices.length} devices…`);
  const lastDPs = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));
  const tempPairs = devices.flatMap((d) => [
    { devID: d.devID, sensor: INLET_TEMP_SENSOR },
    { devID: d.devID, sensor: OUTLET_TEMP_SENSOR },
  ]);
  const tempReadings = await getLastDataPoints(tempPairs);
  const pt1ByDevID = new Map(tempReadings.filter((r) => r.sensor === INLET_TEMP_SENSOR).map((r) => [r.devID, r.value]));
  const pt2ByDevID = new Map(tempReadings.filter((r) => r.sensor === OUTLET_TEMP_SENSOR).map((r) => [r.devID, r.value]));

  // WTD / MTD / YTD windows for the Summary sheet's Performance Indicators + Maintenance Log
  // period columns (DTD = today, the report window itself).
  const wtdRange = getTrailing7DayRange();
  const mtdRange = getMonthToDateRange();
  const ytdRange = getFinancialYearToDateRange();
  const allDevIDs = devices.map((d) => d.devID);

  // Corrective actions: fetch the widest window (YTD) ONCE, then count per window client-side
  // via each record's `dateAndTime` — no separate per-window API calls.
  report('Loading corrective actions (YTD)…');
  const ytdRecords = await getCorrectiveActions(allDevIDs, { startMs: toEpochMs(ytdRange.start), endMs });
  const correctiveActionCountByDevID = countCorrectiveActionsInWindow(ytdRecords, startMs, endMs); // DTD (today)
  const caWtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(wtdRange.start), endMs);
  const caMtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(mtdRange.start), endMs);
  const caYtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(ytdRange.start), endMs);

  // Feedback: fetch each device's createdAt history ONCE, count per window client-side.
  report(`Loading feedback for ${devices.length} devices…`);
  const feedbackDatesByDevID = await getFeedbackDatesByDevice(devices);
  const feedbackCountByDevID = new Map([...feedbackDatesByDevID].map(([id, dates]) => [id, dates.length])); // all-time, for the Analysis sheet

  report(`Analyzing S1 history (today) for ${devices.length} devices…`);
  const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);
  report('Analyzing S1 history (WTD)…');
  const wtdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(wtdRange.start), endMs);
  // Fast mode (design/testing): compute only DTD + WTD. The MTD and YTD windows require two more
  // full-fleet S1 sweeps (YTD ≈ the whole financial year) — the slowest part — so they're skipped
  // and their Summary cells shown as 0.
  const emptyStats = new Map<string, DeviceTimeSeriesStats>();
  let mtdStats = emptyStats;
  let ytdStats = emptyStats;
  if (!opts?.fast) {
    report('Analyzing S1 history (MTD)…');
    mtdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(mtdRange.start), endMs);
    report('Analyzing S1 history (YTD)…');
    ytdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(ytdRange.start), endMs);
  }

  report(`Loading device properties (pressure, baseline temps, leak rate) for ${devices.length} devices…`);
  const propertiesByDevID = await getDevicePropertiesByDevice(devices);

  report(`Loading steam loss for ${devices.length} devices…`);
  const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);

  report(`Loading steam saving for ${devices.length} devices…`);
  const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

  report('Assembling per-unit reports…');
  const allAnalysisRows = buildDailyAnalysisRows(
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
  const allLiveStatusRows = buildDailyLiveStatusRows(devices, lastDPs, { pt1ByDevID, pt2ByDevID }, propertiesByDevID);

  const unitNames = [...new Set(allAnalysisRows.map((r) => r.department))].sort((a, b) => a.localeCompare(b));

  /** Windowed steam loss + saving (MT) for a unit's devices — one batched call each. */
  const windowSteam = (unitDevices: Device[], win: DateRange) =>
    Promise.all([
      getSteamConsumptionTotal(unitDevices, STEAM_LOSS_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
      getSteamConsumptionTotal(unitDevices, STEAM_SAVING_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
    ]);

  const reports: DailyUnitReport[] = [];
  for (const unitName of unitNames) {
    const unitDevices = devices.filter((d) => (extractDepartmentFromTags(d.tags) ?? UNASSIGNED) === unitName);
    const unitDevIDs = unitDevices.map((d) => d.devID);
    const analysisRows = allAnalysisRows
      .filter((r) => r.department === unitName)
      .map((r, i) => ({ ...r, srNo: i + 1 }));
    const liveStatusRows = allLiveStatusRows
      .filter((r) => r.department === unitName)
      .map((r, i) => ({ ...r, srNo: i + 1 }));

    report(`Loading steam loss/saving for ${unitName}…`);
    const [wtdLoss, wtdSave] = await windowSteam(unitDevices, wtdRange);
    let mtdLoss = 0;
    let mtdSave = 0;
    let ytdLoss = 0;
    let ytdSave = 0;
    if (!opts?.fast) {
      [[mtdLoss, mtdSave], [ytdLoss, ytdSave]] = await Promise.all([
        windowSteam(unitDevices, mtdRange),
        windowSteam(unitDevices, ytdRange),
      ]);
    }

    const windowValues = (
      stats: Map<string, DeviceTimeSeriesStats>,
      caCount: Map<string, number>,
      lossMT: number,
      saveMT: number,
      winStartMs: number,
    ): SummaryWindowValues => ({
      trapHealthPct: unitHealthPct(unitDevices, stats),
      steamLossMT: lossMT,
      steamSavingMT: saveMT,
      statusChanges: unitStatusChanges(unitDevices, stats),
      correctiveActions: sumForDevices(unitDevIDs, caCount),
      feedback: countFeedbackInWindow(unitDevices, feedbackDatesByDevID, winStartMs, endMs),
    });
    const zeroWindow: SummaryWindowValues = {
      trapHealthPct: 0,
      steamLossMT: 0,
      steamSavingMT: 0,
      statusChanges: 0,
      correctiveActions: 0,
      feedback: 0,
    };
    const periods = {
      wtd: windowValues(wtdStats, caWtd, wtdLoss, wtdSave, toEpochMs(wtdRange.start)),
      mtd: opts?.fast ? zeroWindow : windowValues(mtdStats, caMtd, mtdLoss, mtdSave, toEpochMs(mtdRange.start)),
      ytd: opts?.fast ? zeroWindow : windowValues(ytdStats, caYtd, ytdLoss, ytdSave, toEpochMs(ytdRange.start)),
    };

    const workbook = new Workbook();
    workbook.creator = 'HMEL Steamtrap Reports';
    workbook.created = generatedAt;
    const logoImageId = workbook.addImage({ base64: HMEL_LOGO_DAILY_BASE64, extension: 'png' });

    const summarySheet = workbook.addWorksheet('Summary');
    buildDailySummarySheet(
      summarySheet,
      unitName,
      derivePlantCategory(unitName),
      unitDevices,
      lastDPs,
      range,
      generatedAt,
      analysisRows.reduce((sum, r) => sum + r.correctiveActionCount, 0),
      countFeedbackInWindow(unitDevices, feedbackDatesByDevID, startMs, endMs),
      analysisRows.reduce((sum, r) => sum + r.statusChangeCount, 0),
      analysisRows.reduce((sum, r) => sum + r.steamLoss, 0),
      analysisRows.reduce((sum, r) => sum + r.steamSaving, 0),
      periods,
      logoImageId,
    );
    const analysisSheet = workbook.addWorksheet('Analysis');
    buildDailyAnalysisSheet(analysisSheet, analysisRows);
    const liveStatusSheet = workbook.addWorksheet('Live Status');
    buildDailyLiveStatusSheet(liveStatusSheet, liveStatusRows);

    // Print setup (printing only), dynamic per sheet so the layouts can never cross over:
    //  - Summary: A4 portrait, whole sheet on exactly one page, no print header/footer at all.
    //  - Analysis & Live Status: A3 landscape, all columns on one page wide, repeating header row,
    //    report-name title, report date, and "Page X of Y" footer.
    const reportDate = formatReportDate(range.end);
    const title = `Steam Trap Daily Report–${unitName.trim()}`;
    applySummaryPrintLayout(summarySheet);
    applyPrintLayout(analysisSheet, { reportDate, title, repeatHeaderRow: 1 });
    applyPrintLayout(liveStatusSheet, { reportDate, title, repeatHeaderRow: 1 });

    reports.push({
      unitName,
      reportName: dailyReportName(unitName, generatedAt),
      fileName: dailyReportFileName(unitName, generatedAt),
      workbook,
    });
  }
  return reports;
}
