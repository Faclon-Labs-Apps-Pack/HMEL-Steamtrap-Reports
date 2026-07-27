import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof Workbook>;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice, getSteamConsumptionTotal } from '../services/steamConsumptionApi';
import { extractDepartmentFromTags } from '../lib/departmentTag';
import { derivePlantCategory, UNASSIGNED } from '../lib/plantCategory';
import { segregateByUnit } from '../lib/segregateByUnit';
import { buildCorrectiveActionCountByDevice, segregateCorrectiveActionsAndChanges } from '../lib/segregateCorrectiveActions';
import { buildDeviceDetailRows } from '../lib/buildDeviceDetailRows';
import { buildCorrectiveActionLogRows } from '../lib/buildCorrectiveActionLogRows';
import { getLastMonthRange, normalizeDateRange, toEpochMs } from '../lib/dateRange';
import { buildOverviewSheet, type SteamKpiTotals } from './buildOverviewSheet';
import { buildDetailSheet } from './buildDetailSheet';
import { buildCorrectiveActionLogSheet } from './buildCorrectiveActionLogSheet';
import type { Device } from '../types/device';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const STEAM_LOSS_SENSOR = 'D11';
const STEAM_SAVING_SENSOR = 'D12';
/** Hardcoded per explicit request — matches the "Cost of Steam (Rs)" row shown in the overview sheet. */
const COST_OF_STEAM_PER_TON = 2473;

export interface MonthlyReportProgress {
  label: string;
}

/** Builds the section KPI totals from single batched loss/saving figures (× the hardcoded cost of steam for INR). */
function sectionKpis(steamLossMT: number, steamSavingMT: number): SteamKpiTotals {
  return {
    steamLossMT,
    lossINR: steamLossMT * COST_OF_STEAM_PER_TON,
    steamSavingMT,
    savingsINR: steamSavingMT * COST_OF_STEAM_PER_TON,
  };
}

function devicesInCategory(devices: Device[], plantCategory: string): Device[] {
  return devices.filter(
    (d) => derivePlantCategory(extractDepartmentFromTags(d.tags) ?? UNASSIGNED) === plantCategory,
  );
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

  // Section-level steam KPI: ONE batched call per plant-category section (all devices at once)
  // for loss (D11) and saving (D12) — matches the dashboard's batched figure, which is NOT the
  // per-device sum. Only the overview sheets use these; per-device detail columns above still
  // come from the per-device calls.
  report('Loading section steam loss/saving totals…');
  const refineryDevices = devicesInCategory(devices, 'Refinery');
  const petchemDevices = devicesInCategory(devices, 'Petchem');
  const [refineryLossMT, refinerySavingMT, petchemLossMT, petchemSavingMT] = await Promise.all([
    getSteamConsumptionTotal(refineryDevices, STEAM_LOSS_SENSOR, startMs, endMs),
    getSteamConsumptionTotal(refineryDevices, STEAM_SAVING_SENSOR, startMs, endMs),
    getSteamConsumptionTotal(petchemDevices, STEAM_LOSS_SENSOR, startMs, endMs),
    getSteamConsumptionTotal(petchemDevices, STEAM_SAVING_SENSOR, startMs, endMs),
  ]);

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
    sectionKpis(refineryLossMT, refinerySavingMT),
  );
  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-petchem'),
    'Petchem',
    range,
    generatedAt,
    matrix,
    correctiveActionMatrix,
    sectionKpis(petchemLossMT, petchemSavingMT),
  );
  buildDetailSheet(workbook.addWorksheet('Refinery'), refineryRows);
  buildDetailSheet(workbook.addWorksheet('Petchem'), petchemRows);
  buildCorrectiveActionLogSheet(workbook.addWorksheet('Corrective Action Log'), logRows);

  return workbook;
}
