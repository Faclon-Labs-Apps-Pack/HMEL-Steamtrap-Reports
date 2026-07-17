import { extractDepartmentFromTags } from './departmentTag';
import { derivePlantCategory, UNASSIGNED } from './plantCategory';
import { STATUS_COLUMNS, type StatusColumn } from './statusClassification';
import type { Device, LastDataPoint } from '../types/device';
import type { DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';
import type { SteamTrapProperties } from '../services/devicePropertiesApi';

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
  leakRate: string;
  steamSavingMT: number;
  steamLossMT: number;
  costOfSteamPerTon: number | undefined;
  lossINR: number | undefined;
  savingsINR: number | undefined;
  [key: string]: unknown;
}

function emptyPercentages(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function buildDeviceDetailRows(
  devices: Device[],
  lastDPs: LastDataPoint[],
  timeSeriesStatsByDevID: Map<string, DeviceTimeSeriesStats>,
  correctiveActionCountByDevID: Map<string, number>,
  feedbackCountByDevID: Map<string, number>,
  propertiesByDevID: Map<string, SteamTrapProperties>,
  steamLossByDevID: Map<string, number>,
  steamSavingByDevID: Map<string, number>,
  durationHours: number,
): DeviceDetailRow[] {
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  return devices.map((device) => {
    const unit = extractDepartmentFromTags(device.tags) ?? UNASSIGNED;
    const stats = timeSeriesStatsByDevID.get(device.devID);
    const properties = propertiesByDevID.get(device.devID);
    const costOfSteamPerTon = toNumber(properties?.costOfSteam);
    const steamLossMT = steamLossByDevID.get(device.devID) ?? 0;
    const steamSavingMT = steamSavingByDevID.get(device.devID) ?? 0;

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
      leakRate: properties?.leakRate || 'N/A',
      steamSavingMT,
      steamLossMT,
      costOfSteamPerTon,
      lossINR: costOfSteamPerTon !== undefined ? steamLossMT * costOfSteamPerTon : undefined,
      savingsINR: costOfSteamPerTon !== undefined ? steamSavingMT * costOfSteamPerTon : undefined,
    };
  });
}
