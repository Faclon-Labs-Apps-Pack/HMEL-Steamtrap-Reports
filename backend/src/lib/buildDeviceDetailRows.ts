import { extractDepartmentFromTags } from './departmentTag';
import { derivePlantCategory, UNASSIGNED } from './plantCategory';
import { STATUS_COLUMNS, type StatusColumn } from './statusClassification';
import type { Device, LastDataPoint } from '../types/device';
import type { DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';

export interface DeviceDetailRow {
  id: string;
  devID: string;
  location: string;
  unit: string;
  plantCategory: string;
  currentStatus: LastDataPoint['value'] | undefined;
  durationHours: number;
  statusPercentages: Record<StatusColumn, number>;
  statusChangeCount: number;
  correctiveActionCount: number;
  feedbackCount: number;
  [key: string]: unknown;
}

function emptyPercentages(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
}

export function buildDeviceDetailRows(
  devices: Device[],
  lastDPs: LastDataPoint[],
  timeSeriesStatsByDevID: Map<string, DeviceTimeSeriesStats>,
  correctiveActionCountByDevID: Map<string, number>,
  feedbackCountByDevID: Map<string, number>,
  durationHours: number,
): DeviceDetailRow[] {
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  return devices.map((device) => {
    const unit = extractDepartmentFromTags(device.tags) ?? UNASSIGNED;
    const stats = timeSeriesStatsByDevID.get(device.devID);

    return {
      id: device.devID,
      devID: device.devID,
      location: device.devName,
      unit,
      plantCategory: derivePlantCategory(unit),
      currentStatus: statusByDevID.get(device.devID),
      durationHours,
      statusPercentages: stats?.statusPercentages ?? emptyPercentages(),
      statusChangeCount: stats?.statusChangeCount ?? 0,
      correctiveActionCount: correctiveActionCountByDevID.get(device.devID) ?? 0,
      feedbackCount: feedbackCountByDevID.get(device.devID) ?? 0,
    };
  });
}
