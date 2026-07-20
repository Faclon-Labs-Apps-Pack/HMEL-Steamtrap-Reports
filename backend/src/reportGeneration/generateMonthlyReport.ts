import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof Workbook>;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice } from '../services/steamConsumptionApi';
import { segregateByUnit } from '../lib/segregateByUnit';
import { buildCorrectiveActionCountByDevice, segregateCorrectiveActionsAndChanges } from '../lib/segregateCorrectiveActions';
import { buildDeviceDetailRows, type DeviceDetailRow } from '../lib/buildDeviceDetailRows';
import { buildCorrectiveActionLogRows } from '../lib/buildCorrectiveActionLogRows';
import { getLastMonthRange, normalizeDateRange, toEpochMs } from '../lib/dateRange';
import { buildOverviewSheet, type SteamKpiTotals } from './buildOverviewSheet';
import { buildDetailSheet } from './buildDetailSheet';
import { buildCorrectiveActionLogSheet } from './buildCorrectiveActionLogSheet';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';

export interface MonthlyReportProgress {
  label: string;
}

/**
 * Builds the Monthly Management Report workbook — EXACT same 5-sheet template as
 * `generateManagementReport.ts` (same sheet names, same columns, same `buildOverviewSheet`/
 * `buildDetailSheet`/`buildCorrectiveActionLogSheet` functions), the only difference being the
 * time window: last fully-completed calendar month (via `getLastMonthRange`) instead of last
 * fully-completed week. Status counts in the overview sheets are still instantaneous (current
 * status at generation time); everything else is windowed to that month.
 */
export async function generateMonthlyReportWorkbook(
  onProgress?: (progress: MonthlyReportProgress) => void,
): Promise<Workbook> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

  const range = normalizeDateRange(getLastMonthRange());
  const startMs = toEpochMs(range.start);
  const endMs = toEpochMs(range.end);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  const generatedAt = new Date();

  report(`Loading current status for ${devices.length} devices…`);
  const lastDPs = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));

  report('Loading corrective action log…');
  const lastMonthRecords = await getCorrectiveActions(devices.map((d) => d.devID), { startMs, endMs });

  report(`Loading feedback counts for ${devices.length} devices…`);
  const feedbackCountByDevID = await getFeedbackCountsByDevice(devices);

  report(`Analyzing S1 history for ${devices.length} devices…`);
  const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);

  report(`Loading device properties (pressure, leak rate, cost of steam) for ${devices.length} devices…`);
  const propertiesByDevID = await getDevicePropertiesByDevice(devices);

  report(`Loading steam loss for ${devices.length} devices…`);
  const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);

  report(`Loading steam saving for ${devices.length} devices…`);
  const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

  report('Assembling report…');
  const matrix = segregateByUnit(devices, lastDPs);
  const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(lastMonthRecords);
  const statusChangeCountByDevID = new Map(
    devices.map((d) => [d.devID, timeSeriesStatsByDevID.get(d.devID)?.statusChangeCount ?? 0]),
  );
  const correctiveActionMatrix = segregateCorrectiveActionsAndChanges(
    devices,
    correctiveActionCountByDevID,
    statusChangeCountByDevID,
  );
  const detailRows = buildDeviceDetailRows(
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
  const refineryRows = detailRows.filter((r) => r.plantCategory === 'Refinery');
  const petchemRows = detailRows.filter((r) => r.plantCategory === 'Petchem');
  const logRows = buildCorrectiveActionLogRows(lastMonthRecords, devices);

  const steamKpisFor = (rows: DeviceDetailRow[]): SteamKpiTotals => ({
    steamLossMT: rows.reduce((sum, r) => sum + r.steamLossMT, 0),
    lossINR: rows.reduce((sum, r) => sum + (r.lossINR ?? 0), 0),
    steamSavingMT: rows.reduce((sum, r) => sum + r.steamSavingMT, 0),
    savingsINR: rows.reduce((sum, r) => sum + (r.savingsINR ?? 0), 0),
  });

  const workbook = new Workbook();
  workbook.creator = 'HMEL Steamtrap Reports';
  workbook.created = generatedAt;

  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-Refiner'),
    'Refinery',
    range,
    generatedAt,
    matrix,
    correctiveActionMatrix,
    steamKpisFor(refineryRows),
  );
  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-petchem'),
    'Petchem',
    range,
    generatedAt,
    matrix,
    correctiveActionMatrix,
    steamKpisFor(petchemRows),
  );
  buildDetailSheet(workbook.addWorksheet('Refinery'), refineryRows);
  buildDetailSheet(workbook.addWorksheet('Petchem'), petchemRows);
  buildCorrectiveActionLogSheet(workbook.addWorksheet('Corrective Action Log'), logRows);

  return workbook;
}
