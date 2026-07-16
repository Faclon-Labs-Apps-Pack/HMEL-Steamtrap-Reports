import { Workbook } from 'exceljs';
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice } from '../services/steamConsumptionApi';
import { buildCorrectiveActionCountByDevice } from '../lib/segregateCorrectiveActions';
import { buildDailyAnalysisRows, buildDailyLiveStatusRows } from '../lib/buildDailyReportRows';
import { getTodayRange, normalizeDateRange, toEpochMs } from '../lib/dateRange';
import { buildDailySummarySheet } from './buildDailySummarySheet';
import { buildDailyAnalysisSheet } from './buildDailyAnalysisSheet';
import { buildDailyLiveStatusSheet } from './buildDailyLiveStatusSheet';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const INLET_TEMP_SENSOR = 'PT1';
const OUTLET_TEMP_SENSOR = 'PT2';

export interface DailyReportProgress {
  label: string;
}

/**
 * Builds the 3-sheet Daily Report workbook (Summary, Analysis, Live Status), matching
 * "report templates/steamTrap-DailyReport 2.xlsx"'s structure with help text stripped and real
 * data populated. Unlike the Management Report, this has NO plant-category segregation — one
 * flat list of all steam trap devices, per explicit spec. Windowed to TODAY (not current week)
 * since this is a daily report, matching its name and the source template's own 24hr duration.
 */
export async function generateDailyReportWorkbook(
  onProgress?: (progress: DailyReportProgress) => void,
): Promise<Workbook> {
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

  const workbook = new Workbook();
  workbook.creator = 'HMEL Steamtrap Reports';
  workbook.created = generatedAt;

  buildDailySummarySheet(
    workbook.addWorksheet('Summary'),
    devices,
    lastDPs,
    range,
    generatedAt,
    correctiveActionTotal,
    feedbackTotal,
    statusChangeTotal,
    steamLossTotal,
    steamSavingTotal,
  );
  buildDailyAnalysisSheet(workbook.addWorksheet('Analysis'), analysisRows);
  buildDailyLiveStatusSheet(workbook.addWorksheet('Live Status'), liveStatusRows);

  return workbook;
}
