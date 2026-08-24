import { Workbook } from 'exceljs';
import { collectDailyReportData, type DailyReportProgress } from './collectDailyReportData';
import { buildDailySummarySheet, type SummaryWindowValues } from './buildDailySummarySheet';
import { buildDailyAnalysisSheet } from './buildDailyAnalysisSheet';
import { buildDailyLiveStatusSheet } from './buildDailyLiveStatusSheet';
import { classifyStatus, STATUS_COLUMNS, type StatusColumn } from '../lib/statusClassification';
import { derivePlantCategory } from '../lib/plantCategory';
import { dailyReportFileName } from '../lib/reportNaming';
import { HMEL_LOGO_BASE64 } from './hmelLogo';
import { getCorrectiveActions, type CorrectiveActionRecord } from '../services/correctiveActionApi';
import { getFeedbackDatesByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice, type DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';
import { getSteamConsumptionTotal } from '../services/steamConsumptionApi';
import {
  getTrailing7DayRange,
  getMonthToDateRange,
  getFinancialYearToDateRange,
  toEpochMs,
  type DateRange,
} from '../lib/dateRange';
import type { Device } from '../types/device';

export type { DailyReportProgress };

const STEAM_LOSS_SENSOR = 'D11';
const STEAM_SAVING_SENSOR = 'D12';

function countCorrectiveActionsInWindow(records: CorrectiveActionRecord[], startMs: number, endMs: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const t = new Date(r.dateAndTime).getTime();
    if (t >= startMs && t <= endMs) counts.set(r.devId, (counts.get(r.devId) ?? 0) + 1);
  }
  return counts;
}

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

function countFeedbackInWindow(unitDevices: Device[], datesByDevID: Map<string, number[]>, startMs: number, endMs: number): number {
  return unitDevices.reduce(
    (s, d) => s + (datesByDevID.get(d.devID) ?? []).filter((t) => t >= startMs && t <= endMs).length,
    0,
  );
}

export interface DailyUnitReport {
  unitName: string;
  fileName: string;
  workbook: Workbook;
}

/**
 * Builds one 3-sheet Daily Report workbook (Summary, Analysis, Live Status) PER UNIT — a unit
 * being the device's "department:<value>" tag, the same grouping the Management Report calls
 * Unit Name. Per explicit client request (2026-07-28) each unit gets its own file, named after
 * the unit. Data is fetched once for all devices (collectDailyReportData), then split by the
 * rows' department field. Windowed to TODAY since this is a daily report.
 */
export async function generateDailyReportWorkbooks(
  onProgress?: (progress: DailyReportProgress) => void,
): Promise<DailyUnitReport[]> {
  const data = await collectDailyReportData(onProgress);
  const report = (label: string) => onProgress?.({ label });

  const endMs = toEpochMs(data.range.end);
  const wtdRange = getTrailing7DayRange();
  const mtdRange = getMonthToDateRange();
  const ytdRange = getFinancialYearToDateRange();

  // Corrective actions: fetch the widest window (YTD) once, count per window via `dateAndTime`.
  report('Loading corrective actions (YTD)…');
  const ytdRecords = await getCorrectiveActions(data.devices.map((d) => d.devID), {
    startMs: toEpochMs(ytdRange.start),
    endMs,
  });
  const caWtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(wtdRange.start), endMs);
  const caMtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(mtdRange.start), endMs);
  const caYtd = countCorrectiveActionsInWindow(ytdRecords, toEpochMs(ytdRange.start), endMs);

  report('Loading feedback history…');
  const feedbackDatesByDevID = await getFeedbackDatesByDevice(data.devices);

  report('Analyzing S1 history (WTD)…');
  const wtdStats = await getTimeSeriesStatsByDevice(data.devices, toEpochMs(wtdRange.start), endMs);
  report('Analyzing S1 history (MTD)…');
  const mtdStats = await getTimeSeriesStatsByDevice(data.devices, toEpochMs(mtdRange.start), endMs);
  report('Analyzing S1 history (YTD)…');
  const ytdStats = await getTimeSeriesStatsByDevice(data.devices, toEpochMs(ytdRange.start), endMs);

  const windowSteam = (unitDevices: Device[], win: DateRange) =>
    Promise.all([
      getSteamConsumptionTotal(unitDevices, STEAM_LOSS_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
      getSteamConsumptionTotal(unitDevices, STEAM_SAVING_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
    ]);

  const unitNames = [...new Set(data.analysisRows.map((r) => r.department))].sort((a, b) => a.localeCompare(b));

  const reports: DailyUnitReport[] = [];
  for (const unitName of unitNames) {
    const analysisRows = data.analysisRows
      .filter((r) => r.department === unitName)
      .map((r, i) => ({ ...r, srNo: i + 1 }));
    const liveStatusRows = data.liveStatusRows
      .filter((r) => r.department === unitName)
      .map((r, i) => ({ ...r, srNo: i + 1 }));

    const unitDevIDs = new Set(analysisRows.map((r) => r.devID));
    const unitDevices = data.devices.filter((d) => unitDevIDs.has(d.devID));
    const unitDevIDList = [...unitDevIDs];

    const statusCounts = Object.fromEntries(STATUS_COLUMNS.map((c) => [c, 0])) as Record<StatusColumn, number>;
    for (const r of analysisRows) statusCounts[classifyStatus(r.currentStatus)] += 1;

    report(`Loading WTD/MTD/YTD steam loss/saving for ${unitName}…`);
    const [[wtdLoss, wtdSave], [mtdLoss, mtdSave], [ytdLoss, ytdSave]] = await Promise.all([
      windowSteam(unitDevices, wtdRange),
      windowSteam(unitDevices, mtdRange),
      windowSteam(unitDevices, ytdRange),
    ]);

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
      correctiveActions: sumForDevices(unitDevIDList, caCount),
      feedback: countFeedbackInWindow(unitDevices, feedbackDatesByDevID, winStartMs, endMs),
    });
    const periods = {
      wtd: windowValues(wtdStats, caWtd, wtdLoss, wtdSave, toEpochMs(wtdRange.start)),
      mtd: windowValues(mtdStats, caMtd, mtdLoss, mtdSave, toEpochMs(mtdRange.start)),
      ytd: windowValues(ytdStats, caYtd, ytdLoss, ytdSave, toEpochMs(ytdRange.start)),
    };

    const workbook = new Workbook();
    workbook.creator = 'HMEL Steamtrap Reports';
    workbook.created = data.generatedAt;
    const logoImageId = workbook.addImage({ base64: HMEL_LOGO_BASE64, extension: 'png' });

    buildDailySummarySheet(
      workbook.addWorksheet('Summary'),
      unitName,
      derivePlantCategory(unitName),
      unitDevices,
      statusCounts,
      data.range,
      data.generatedAt,
      analysisRows.reduce((sum, r) => sum + r.correctiveActionCount, 0),
      countFeedbackInWindow(unitDevices, feedbackDatesByDevID, toEpochMs(data.range.start), endMs),
      analysisRows.reduce((sum, r) => sum + r.statusChangeCount, 0),
      analysisRows.reduce((sum, r) => sum + r.steamLoss, 0),
      analysisRows.reduce((sum, r) => sum + r.steamSaving, 0),
      periods,
      logoImageId,
    );
    buildDailyAnalysisSheet(workbook.addWorksheet('Analysis'), analysisRows);
    buildDailyLiveStatusSheet(workbook.addWorksheet('Live Status'), liveStatusRows);

    reports.push({ unitName, fileName: dailyReportFileName(unitName, data.generatedAt), workbook });
  }
  return reports;
}
