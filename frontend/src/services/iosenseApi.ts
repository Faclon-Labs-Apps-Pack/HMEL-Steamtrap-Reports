import { getOrganisation, getStoredToken } from '../auth/auth';
import type { Device, LastDataPoint } from '../types/device';

const API_BASE = import.meta.env.VITE_IOSENSE_API_BASE ?? 'https://connector.iosense.io/api';

export class ApiError extends Error {}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredToken();
  if (!token) throw new ApiError('Not authenticated. No JWT available.');
  return {
    Authorization: token,
    organisation: getOrganisation(),
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
 * that would skew per-device tables and counts). Filtered centrally here so every page and
 * both report generators stay consistent automatically.
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

    const body: FindUserDevicesResponse = await response.json();
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

  const body: GetLastDPsResponse = await response.json();
  if (!response.ok || !body.success) {
    throw new ApiError('Failed to fetch latest sensor readings from IOsense.');
  }

  return body.data;
}

export interface TimeSeriesPoint {
  time: string;
  value: number;
}

interface GetDataByTimeRangeResponse {
  success: boolean;
  // One sub-array per requested (devID, sensor) pair — here always exactly one, since this
  // hits the single-pair endpoint. Confirmed against a live response (2026-07-16): the API
  // returns `data: [[{time, value}, ...]]`, NOT a flat `data: [{time, value}, ...]`.
  data: TimeSeriesPoint[][];
}

/** Fetches raw/calibrated time-series points for one (devID, sensor) pair within [startMs, endMs]. */
export async function getDeviceTimeSeries(
  devID: string,
  sensor: string,
  startMs: number,
  endMs: number,
  calibration = true,
): Promise<TimeSeriesPoint[]> {
  const response = await fetch(
    `${API_BASE}/account/deviceData/getDataCalibration/${devID}/${sensor}/${startMs}/${endMs}/${calibration}`,
    {
      method: 'GET',
      headers: {
        Authorization: getStoredToken(),
        'Content-Type': 'application/json',
      },
    },
  );

  const body: GetDataByTimeRangeResponse = await response.json();
  if (!response.ok || !body.success) {
    throw new ApiError(`Failed to fetch time series for device ${devID}.`);
  }

  return body.data?.[0] ?? [];
}

interface AutoDownSampledEntry {
  devID: string;
  sensor: string;
  /** Keys are ISO timestamps, values are numeric readings. Confirmed live (2026-07-16). */
  data: Record<string, number>;
}

interface GetAutoDownSampledResponse {
  success: boolean;
  data: AutoDownSampledEntry[];
}

/**
 * Fetches time-series for MANY (devID, sensor) pairs in a single request — the bulk
 * counterpart to `getDeviceTimeSeries`. Use this instead of looping `getDeviceTimeSeries`
 * per device: one HTTP call instead of N, which matters a lot at ~200 steam trap devices
 * (confirmed live: at downscale=500 this returns effectively full point density for a
 * 7-day S1 range — no meaningful data loss for status-change counting at that scale).
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
    headers: {
      Authorization: getStoredToken(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      devConfig: pairs.map((p) => ({ devID: p.devID, sensor: p.sensor, sTime: startMs, eTime: endMs, downscale })),
    }),
  });

  const body: GetAutoDownSampledResponse = await response.json();
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
 * live here (confirmed live 2026-07-16), NOT in `findUserDevices`'s response. No known bulk
 * equivalent, so this is one request per device — see `getDevicePropertiesByDevice`.
 */
export async function getDeviceMetadata(devID: string): Promise<DeviceProperty[]> {
  const response = await fetch(`${API_BASE}/account/ai-sdk/metaData/device/${devID}`, {
    method: 'GET',
    headers: {
      Authorization: getStoredToken(),
      Accept: 'application/json',
    },
  });

  const body: GetDeviceMetadataResponse = await response.json();
  if (!response.ok || !body.success) {
    throw new ApiError(`Failed to fetch metadata for device ${devID}.`);
  }

  return body.data.properties ?? [];
}

