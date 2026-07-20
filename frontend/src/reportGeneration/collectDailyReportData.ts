import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice } from '../services/steamConsumptionApi';
import { buildCorrectiveActionCountByDevice } from '../lib/segregateCorrectiveActions';
import {
  buildDailyAnalysisRows,
  buildDailyLiveStatusRows,
  type DailyAnalysisRow,
  type DailyLiveStatusRow,
} from '../lib/buildDailyReportRows';
import { getTodayRange, normalizeDateRange, toEpochMs, type DateRange } from '../lib/dateRange';
import { classifyStatus, STATUS_COLUMNS, type StatusColumn } from '../lib/statusClassification';
import type { Device } from '../types/device';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const INLET_TEMP_SENSOR = 'PT1';
const OUTLET_TEMP_SENSOR = 'PT2';

/** Hardcoded per explicit request — not derived from device data. Matches buildDailySummarySheet.ts. */
export const DAILY_REPORT_COST_OF_STEAM = 2473;

export interface DailyReportProgress {
  label: string;
}

export interface DailyReportData {
  range: DateRange;
  generatedAt: Date;
  devices: Device[];
  statusCounts: Record<StatusColumn, number>;
  correctiveActionTotal: number;
  feedbackTotal: number;
  statusChangeTotal: number;
  steamLossTotal: number;
  steamSavingTotal: number;
  analysisRows: DailyAnalysisRow[];
  liveStatusRows: DailyLiveStatusRow[];
}

/**
 * Fetches and assembles everything the Daily Report needs (both the .xlsx generator and the
 * on-screen Daily Report tab consume this). Windowed to TODAY, no plant-category segregation —
 * see `generateDailyReport.ts` for why.
 */
export async function collectDailyReportData(
  onProgress?: (progress: DailyReportProgress) => void,
): Promise<DailyReportData> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

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

  report('Loading today’s corrective actions…');
  const todayRecords = await getCorrectiveActions(devices.map((d) => d.devID), { startMs, endMs });
  const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(todayRecords);

  report(`Loading feedback counts for ${devices.length} devices…`);
  const feedbackCountByDevID = await getFeedbackCountsByDevice(devices);

  report(`Analyzing today's S1 history for ${devices.length} devices…`);
  const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);

  report(`Loading device properties (pressure, baseline temps, leak rate) for ${devices.length} devices…`);
  const propertiesByDevID = await getDevicePropertiesByDevice(devices);

  report(`Loading steam loss for ${devices.length} devices…`);
  const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);

  report(`Loading steam saving for ${devices.length} devices…`);
  const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

  report('Assembling report…');
  const correctiveActionTotal = [...correctiveActionCountByDevID.values()].reduce((sum, n) => sum + n, 0);
  const feedbackTotal = [...feedbackCountByDevID.values()].reduce((sum, n) => sum + n, 0);
  const statusChangeTotal = devices.reduce(
    (sum, d) => sum + (timeSeriesStatsByDevID.get(d.devID)?.statusChangeCount ?? 0),
    0,
  );

  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));
  const statusCounts = Object.fromEntries(STATUS_COLUMNS.map((c) => [c, 0])) as Record<StatusColumn, number>;
  for (const device of devices) {
    statusCounts[classifyStatus(statusByDevID.get(device.devID))] += 1;
  }

  const analysisRows = buildDailyAnalysisRows(
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
  const steamLossTotal = analysisRows.reduce((sum, r) => sum + r.steamLoss, 0);
  const steamSavingTotal = analysisRows.reduce((sum, r) => sum + r.steamSaving, 0);
  const liveStatusRows = buildDailyLiveStatusRows(devices, lastDPs, { pt1ByDevID, pt2ByDevID }, propertiesByDevID);

  return {
    range,
    generatedAt,
    devices,
    statusCounts,
    correctiveActionTotal,
    feedbackTotal,
    statusChangeTotal,
    steamLossTotal,
    steamSavingTotal,
    analysisRows,
    liveStatusRows,
  };
}
