import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice, getSteamConsumptionTotal } from '../services/steamConsumptionApi';
import { extractDepartmentFromTags } from '../lib/departmentTag';
import { derivePlantCategory, UNASSIGNED } from '../lib/plantCategory';
import { segregateByUnit, type UnitStatusMatrix } from '../lib/segregateByUnit';
import { buildCorrectiveActionCountByDevice, segregateCorrectiveActionsAndChanges } from '../lib/segregateCorrectiveActions';
import type { CorrectiveActionMatrixData } from '../lib/segregateCorrectiveActions';
import { buildDeviceDetailRows, type DeviceDetailRow } from '../lib/buildDeviceDetailRows';
import type { Device } from '../types/device';
import { buildCorrectiveActionLogRows, type CorrectiveActionLogRow } from '../lib/buildCorrectiveActionLogRows';
import { getLastWeekRange, normalizeDateRange, toEpochMs, type DateRange } from '../lib/dateRange';
import type { SteamKpiTotals } from './buildOverviewSheet';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const STEAM_LOSS_SENSOR = 'D11';
const STEAM_SAVING_SENSOR = 'D12';
/** Hardcoded per explicit request — matches the "Cost of Steam (Rs)" row shown in the overview sheet. */
const COST_OF_STEAM_PER_TON = 2473;

export interface ManagementReportProgress {
  label: string;
}

export interface ManagementReportData {
  range: DateRange;
  generatedAt: Date;
  matrix: UnitStatusMatrix;
  correctiveActionMatrix: CorrectiveActionMatrixData;
  refineryRows: DeviceDetailRow[];
  petchemRows: DeviceDetailRow[];
  logRows: CorrectiveActionLogRow[];
  refineryKpis: SteamKpiTotals;
  petchemKpis: SteamKpiTotals;
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
 * Fetches and assembles everything the Management Report needs (the .xlsx generator, the
 * on-screen Weekly Report tab, AND the Monthly Report generator all consume this — single
 * source of truth for the data, separate from how it's ultimately rendered/windowed). Defaults
 * to the last fully-completed week — see `generateManagementReport.ts` for why — but callers
 * that need a different window (e.g. `generateMonthlyReport.ts`, windowed to the last
 * fully-completed calendar month instead) can pass `rangeOverride` explicitly.
 */
export async function collectManagementReportData(
  onProgress?: (progress: ManagementReportProgress) => void,
  rangeOverride?: DateRange,
): Promise<ManagementReportData> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

  const range = rangeOverride ?? normalizeDateRange(getLastWeekRange());
  const startMs = toEpochMs(range.start);
  const endMs = toEpochMs(range.end);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  const generatedAt = new Date();

  report(`Loading current status for ${devices.length} devices…`);
  const lastDPs = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));

  report('Loading corrective action log…');
  const lastWeekRecords = await getCorrectiveActions(devices.map((d) => d.devID), { startMs, endMs });

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

  // Section-level steam KPI: ONE batched call per plant-category section (all devices in the
  // section at once) for loss (D11) and saving (D12) — matches the dashboard's batched figure,
  // which is NOT the same as the per-device sum. Only the overview sheets use these; the
  // per-device detail columns above still come from the per-device calls.
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
  const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(lastWeekRecords);
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
  const logRows = buildCorrectiveActionLogRows(lastWeekRecords, devices);

  return {
    range,
    generatedAt,
    matrix,
    correctiveActionMatrix,
    refineryRows,
    petchemRows,
    logRows,
    refineryKpis: sectionKpis(refineryLossMT, refinerySavingMT),
    petchemKpis: sectionKpis(petchemLossMT, petchemSavingMT),
  };
}
