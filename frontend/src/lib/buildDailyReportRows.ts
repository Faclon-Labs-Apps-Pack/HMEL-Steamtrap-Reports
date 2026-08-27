import { extractDepartmentFromTags } from './departmentTag';
import { UNASSIGNED } from './plantCategory';
import { classifyStatus, STATUS_COLUMNS, type StatusColumn } from './statusClassification';
import type { Device, LastDataPoint } from '../types/device';
import type { DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';
import type { SteamTrapProperties } from '../services/devicePropertiesApi';

function emptyPercentages(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
}

export interface DailyAnalysisRow {
  id: string;
  srNo: number;
  devID: string;
  /** The device's friendly name (its "Tag No" in the report, e.g. "510-HPST-001"). */
  devName: string;
  location: string;
  department: string;
  currentStatus: LastDataPoint['value'] | undefined;
  durationHours: number;
  statusPercentages: Record<StatusColumn, number>;
  statusChangeCount: number;
  correctiveActionCount: number;
  feedbackCount: number;
  leakRate: string;
  costOfSteam: string;
  steamSaving: number;
  steamLoss: number;
  [key: string]: unknown;
}

export interface DailyLiveStatusRow {
  id: string;
  srNo: number;
  devID: string;
  /** The device's friendly name (its "Tag No" in the report). */
  devName: string;
  location: string;
  department: string;
  inletPressure: string;
  outletPressure: string;
  baseLineInletTemperature: string;
  baseLineOutletTemperature: string;
  liveInletTemperature: string;
  liveOutletTemperature: string;
  status: StatusColumn;
  [key: string]: unknown;
}

function locationFor(device: Device, properties: SteamTrapProperties | undefined): string {
  return properties?.trapLocation || device.devName;
}

export function buildDailyAnalysisRows(
  devices: Device[],
  lastDPs: LastDataPoint[],
  timeSeriesStatsByDevID: Map<string, DeviceTimeSeriesStats>,
  correctiveActionCountByDevID: Map<string, number>,
  feedbackCountByDevID: Map<string, number>,
  propertiesByDevID: Map<string, SteamTrapProperties>,
  steamLossByDevID: Map<string, number>,
  steamSavingByDevID: Map<string, number>,
  durationHours: number,
): DailyAnalysisRow[] {
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  return devices.map((device, index) => {
    const properties = propertiesByDevID.get(device.devID);
    const stats = timeSeriesStatsByDevID.get(device.devID);

    return {
      id: device.devID,
      srNo: index + 1,
      devID: device.devID,
      devName: device.devName,
      location: locationFor(device, properties),
      department: extractDepartmentFromTags(device.tags) ?? UNASSIGNED,
      currentStatus: statusByDevID.get(device.devID),
      durationHours,
      statusPercentages: stats?.statusPercentages ?? emptyPercentages(),
      statusChangeCount: stats?.statusChangeCount ?? 0,
      correctiveActionCount: correctiveActionCountByDevID.get(device.devID) ?? 0,
      feedbackCount: feedbackCountByDevID.get(device.devID) ?? 0,
      leakRate: properties?.leakRate || 'N/A',
      costOfSteam: properties?.costOfSteam !== undefined ? String(properties.costOfSteam) : 'N/A',
      steamSaving: steamSavingByDevID.get(device.devID) ?? 0,
      steamLoss: steamLossByDevID.get(device.devID) ?? 0,
    };
  });
}

export function buildDailyLiveStatusRows(
  devices: Device[],
  lastDPs: LastDataPoint[],
  liveTemperatures: { pt1ByDevID: Map<string, number | string>; pt2ByDevID: Map<string, number | string> },
  propertiesByDevID: Map<string, SteamTrapProperties>,
): DailyLiveStatusRow[] {
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  return devices.map((device, index) => {
    const properties = propertiesByDevID.get(device.devID);
    const pt1 = liveTemperatures.pt1ByDevID.get(device.devID);
    const pt2 = liveTemperatures.pt2ByDevID.get(device.devID);
    const formatTemp = (value: number | string | undefined) =>
      value !== undefined ? `${typeof value === 'number' ? Number(value.toFixed(2)) : value} °C` : 'N/A';

    return {
      id: device.devID,
      srNo: index + 1,
      devID: device.devID,
      devName: device.devName,
      location: locationFor(device, properties),
      department: extractDepartmentFromTags(device.tags) ?? UNASSIGNED,
      inletPressure: properties?.inletPressure || 'N/A',
      outletPressure: properties?.outletPressure || 'N/A',
      baseLineInletTemperature: properties?.baseLineInletTemperature || 'N/A',
      baseLineOutletTemperature: properties?.baseLineOutletTemperature || 'N/A',
      liveInletTemperature: formatTemp(pt1),
      liveOutletTemperature: formatTemp(pt2),
      status: classifyStatus(statusByDevID.get(device.devID)),
    };
  });
}
