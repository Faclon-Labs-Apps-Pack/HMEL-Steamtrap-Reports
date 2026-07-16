import { getAuthHeader, getOrgId, API_BASE } from '../config';
import type { Device, LastDataPoint } from '../types/device';

export class ApiError extends Error {}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: getAuthHeader(),
    organisation: getOrgId(),
    'Content-Type': 'application/json',
    'ngsw-bypass': 'true',
    ...extra,
  };
}

interface FindUserDevicesResponse {
  success: boolean;
  data: {
    totalCount: number;
    data: Device[];
  };
}

/**
 * Devices excluded app-wide (not real individual steam traps — e.g. aggregate/rollup devices
 * that would skew per-device tables and counts). Kept in sync with the frontend's
 * `frontend/src/services/iosenseApi.ts` — update both if this list changes.
 */
const IGNORED_DEVICE_IDS = new Set(['STEAM_GLOBAL_AGG_HEML']);

/** Fetches every device whose devType name matches `devTypeName` (e.g. "steam trap"), paginating until exhausted. */
export async function findDevicesByType(devTypeName: string): Promise<Device[]> {
  const limit = 100;
  let skip = 1;
  const devices: Device[] = [];

  while (true) {
    const response = await fetch(`${API_BASE}/account/devices/${skip}/${limit}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        search: { devTypeName: [devTypeName] },
        filter: [],
        order: 'default',
        sort: 'AtoZ',
      }),
    });

    const body = (await response.json()) as FindUserDevicesResponse;
    if (!response.ok || !body.success) {
      throw new ApiError('Failed to fetch devices from IOsense.');
    }

    devices.push(...body.data.data);

    if (devices.length >= body.data.totalCount || body.data.data.length < limit) {
      break;
    }
    skip += 1;
  }

  return devices.filter((d) => !IGNORED_DEVICE_IDS.has(d.devID));
}

interface GetLastDPsResponse {
  success: boolean;
  data: LastDataPoint[];
}

/** Fetches the latest calibrated value for each (devID, sensor) pair in one batch call. */
export async function getLastDataPoints(
  pairs: { devID: string; sensor: string }[],
): Promise<LastDataPoint[]> {
  if (pairs.length === 0) return [];

  const response = await fetch(`${API_BASE}/account/deviceData/getLastDPsofDevicesAndSensorProcessed`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ devices: pairs }),
  });

  const body = (await response.json()) as GetLastDPsResponse;
  if (!response.ok || !body.success) {
    throw new ApiError('Failed to fetch latest sensor readings from IOsense.');
  }

  return body.data;
}

export interface TimeSeriesPoint {
  time: string;
  value: number;
}

interface AutoDownSampledEntry {
  devID: string;
  sensor: string;
  /** Keys are ISO timestamps, values are numeric readings. */
  data: Record<string, number>;
}

interface GetAutoDownSampledResponse {
  success: boolean;
  data: AutoDownSampledEntry[];
}

/**
 * Fetches time-series for MANY (devID, sensor) pairs in a single request. Use this instead of
 * looping a single-pair endpoint per device — one HTTP call instead of N, which matters a lot
 * at ~200 steam trap devices.
 */
export async function getBulkDeviceTimeSeries(
  pairs: { devID: string; sensor: string }[],
  startMs: number,
  endMs: number,
  downscale = 2000,
): Promise<Map<string, TimeSeriesPoint[]>> {
  if (pairs.length === 0) return new Map();

  const response = await fetch(`${API_BASE}/account/widget/getAutoDownSampledData`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      devConfig: pairs.map((p) => ({ devID: p.devID, sensor: p.sensor, sTime: startMs, eTime: endMs, downscale })),
    }),
  });

  const body = (await response.json()) as GetAutoDownSampledResponse;
  if (!response.ok || !body.success) {
    throw new ApiError('Failed to fetch bulk time series from IOsense.');
  }

  const result = new Map<string, TimeSeriesPoint[]>();
  for (const entry of body.data) {
    const points = Object.entries(entry.data)
      .map(([time, value]) => ({ time, value }))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    result.set(entry.devID, points);
  }
  return result;
}

export interface DeviceProperty {
  propertyName: string;
  propertyValue: string | number;
}

interface GetDeviceMetadataResponse {
  success: boolean;
  data: { properties?: DeviceProperty[] };
}

/**
 * Fetches one device's full metadata, for the `properties[]` array — things like
 * `inletPressure`, `baseLineInletTemperature`, `Steam Leak`, `costOfSteam`, `Trap Location`
 * live here, NOT in `findUserDevices`'s response. No known bulk equivalent, so this is one
 * request per device — see `getDevicePropertiesByDevice`.
 */
export async function getDeviceMetadata(devID: string): Promise<DeviceProperty[]> {
  const response = await fetch(`${API_BASE}/account/ai-sdk/metaData/device/${devID}`, {
    method: 'GET',
    headers: { Authorization: getAuthHeader(), organisation: getOrgId(), Accept: 'application/json' },
  });

  const body = (await response.json()) as GetDeviceMetadataResponse;
  if (!response.ok || !body.success) {
    throw new ApiError(`Failed to fetch metadata for device ${devID}.`);
  }

  return body.data.properties ?? [];
}
