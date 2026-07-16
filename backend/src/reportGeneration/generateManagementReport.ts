import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof Workbook>;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { segregateByUnit } from '../lib/segregateByUnit';
import { buildCorrectiveActionCountByDevice, segregateCorrectiveActionsAndChanges } from '../lib/segregateCorrectiveActions';
import { buildDeviceDetailRows } from '../lib/buildDeviceDetailRows';
import { buildCorrectiveActionLogRows } from '../lib/buildCorrectiveActionLogRows';
import { getCurrentWeekRange, normalizeDateRange, toEpochMs } from '../lib/dateRange';
import { buildOverviewSheet } from './buildOverviewSheet';
import { buildDetailSheet } from './buildDetailSheet';
import { buildCorrectiveActionLogSheet } from './buildCorrectiveActionLogSheet';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';

export interface ManagementReportProgress {
  label: string;
}

/**
 * Builds the full 5-sheet Management Report workbook, matching
 * "report templates/ManagementReportFormat for Steam Traps 1 (1).xlsx"'s structure with help
 * text stripped and real data populated. Always uses the current week for time-windowed data
 * (per spec) — status counts in the overview sheets are instantaneous (current status),
 * everything else (percentages, change counts, per-unit corrective action counts, and the
 * Corrective Action Log sheet itself) is windowed to the current week, since this report is
 * generated weekly. (The standalone "Corrective Action Log" dashboard tab is intentionally
 * different — that one stays all-time, since it's a running log rather than a period report.)
 */
export async function generateManagementReportWorkbook(
  onProgress?: (progress: ManagementReportProgress) => void,
): Promise<Workbook> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

  const range = normalizeDateRange(getCurrentWeekRange());
  const startMs = toEpochMs(range.start);
  const endMs = toEpochMs(range.end);
  const durationHours = (endMs - startMs) / (1000 * 60 * 60);
  const generatedAt = new Date();

  report(`Loading current status for ${devices.length} devices…`);
  const lastDPs = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));

  report('Loading corrective action log…');
  const currentWeekRecords = await getCorrectiveActions(devices.map((d) => d.devID), { startMs, endMs });

  report(`Loading feedback counts for ${devices.length} devices…`);
  const feedbackCountByDevID = await getFeedbackCountsByDevice(devices);

  report(`Analyzing S1 history for ${devices.length} devices…`);
  const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);

  report('Assembling report…');
  const matrix = segregateByUnit(devices, lastDPs);
  const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(currentWeekRecords);
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
    durationHours,
  );
  const refineryRows = detailRows.filter((r) => r.plantCategory === 'Refinery');
  const petchemRows = detailRows.filter((r) => r.plantCategory === 'Petchem');
  const logRows = buildCorrectiveActionLogRows(currentWeekRecords, devices);

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
  );
  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-petchem'),
    'Petchem',
    range,
    generatedAt,
    matrix,
    correctiveActionMatrix,
  );
  buildDetailSheet(workbook.addWorksheet('Refinery'), refineryRows);
  buildDetailSheet(workbook.addWorksheet('Petchem'), petchemRows);
  buildCorrectiveActionLogSheet(workbook.addWorksheet('Corrective Action Log'), logRows);

  return workbook;
}
