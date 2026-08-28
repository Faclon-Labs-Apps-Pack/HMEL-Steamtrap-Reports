import { getAuthHeader, getOrgId, API_BASE } from '../config';
import { runWithConcurrencyLimit } from '../lib/concurrency';
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
 * The getAutoDownSampledData endpoint rejects large device lists (confirmed live — a ~285-device
 * request failed while the same token worked for every other endpoint; the reference project
 * that first used this endpoint chunks it in small batches for the same reason). So we split into
 * batches of this many (devID, sensor) pairs and merge the results.
 */
const BULK_TIME_SERIES_BATCH_SIZE = 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// IOsense enforces a DEVICE rate limit on getAutoDownSampledData: at most ~150 devices may be
// requested per rolling 30-second window (confirmed live: "Device rate limit exceeded: 140 of 150
// devices already requested in the current 30-second window … Retry after 22 seconds"). We
// self-throttle a margin under that so we never trip it. This budget is MODULE-LEVEL on purpose —
// it is shared across ALL concurrent report runs (the weekly and daily reports fire together and
// share the same server-side window), so a per-call limiter wouldn't be enough. This does NOT drop
// any devices — every device is still fetched; the requests are just paced over time.
const RATE_LIMIT_MAX_DEVICES = 140;
const RATE_LIMIT_WINDOW_MS = 30_000;
const rateWindow: { at: number; devices: number }[] = [];

/** Blocks until requesting `deviceCount` more devices stays within the 30s device-rate budget. */
async function acquireDeviceRateBudget(deviceCount: number): Promise<void> {
  // A single batch (≤20) never exceeds the cap (140), so this always eventually clears.
  for (;;) {
    const now = Date.now();
    while (rateWindow.length > 0 && now - rateWindow[0].at >= RATE_LIMIT_WINDOW_MS) rateWindow.shift();
    const used = rateWindow.reduce((sum, r) => sum + r.devices, 0);
    if (used + deviceCount <= RATE_LIMIT_MAX_DEVICES) {
      // No await between reading `used` and pushing → atomic vs other concurrent callers.
      rateWindow.push({ at: now, devices: deviceCount });
      return;
    }
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - rateWindow[0].at) + 50;
    await sleep(waitMs);
  }
}

/** If an error carries the API's "Retry after N seconds" hint, returns that in ms (else null). */
function parseRetryAfterMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /Retry after (\d+)\s*seconds?/i.exec(msg);
  return m ? Number(m[1]) * 1000 + 500 : null; // +0.5s cushion past the server's window
}

/**
 * Fetches one batch with retry. Two failure modes are handled: (1) the endpoint intermittently
 * returns HTTP 200 `{"success":false}` under load (transient — a plain retry recovers it), and
 * (2) the device rate limit, which the proactive throttle (acquireDeviceRateBudget) should
 * prevent, but if it still fires we honor the server's "Retry after N seconds" hint instead of the
 * short exponential backoff.
 */
async function fetchBulkTimeSeriesBatchWithRetry(
  pairs: { devID: string; sensor: string }[],
  startMs: number,
  endMs: number,
  downscale: number,
  attempts = 5,
): Promise<Map<string, TimeSeriesPoint[]>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetchBulkTimeSeriesBatch(pairs, startMs, endMs, downscale);
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        const retryAfter = parseRetryAfterMs(err);
        await sleep(retryAfter ?? 500 * 2 ** attempt); // honor "Retry after Ns", else 0.5s,1s,2s,4s
      }
    }
  }
  throw lastError;
}

/** Fetches one batch of (devID, sensor) pairs from getAutoDownSampledData. */
async function fetchBulkTimeSeriesBatch(
  pairs: { devID: string; sensor: string }[],
  startMs: number,
  endMs: number,
  downscale: number,
): Promise<Map<string, TimeSeriesPoint[]>> {
  // Stay within the server's device rate limit (≤150 devices / 30s) — blocks here if needed so we
  // never trip it. Shared across all concurrent report runs.
  await acquireDeviceRateBudget(pairs.length);

  // Hard request timeout: IOsense intermittently holds a connection open without responding, and
  // fetch() has no built-in timeout — one such hang would stall the whole report forever (the
  // retry below never fires because the promise never settles). Abort after 30s so it throws and
  // the caller's retry recovers.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/account/widget/getAutoDownSampledData`, {
      method: 'PUT',
      headers: authHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        devConfig: pairs.map((p) => ({ devID: p.devID, sensor: p.sensor, sTime: startMs, eTime: endMs, downscale })),
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let body: GetAutoDownSampledResponse;
  try {
    body = JSON.parse(rawText) as GetAutoDownSampledResponse;
  } catch {
    throw new ApiError(`Failed to fetch bulk time series from IOsense (HTTP ${response.status}, non-JSON): ${rawText.slice(0, 300)}`);
  }
  if (!response.ok || !body.success) {
    throw new ApiError(
      `Failed to fetch bulk time series from IOsense (HTTP ${response.status}, ${pairs.length} pairs): ${rawText.slice(0, 300)}`,
    );
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

/**
 * Fetches time-series for MANY (devID, sensor) pairs. Splits into batches (the endpoint rejects
 * large lists — see BULK_TIME_SERIES_BATCH_SIZE) and runs them concurrency-limited, merging into
 * one map. Still far fewer HTTP calls than one-per-device, but small enough per call that the
 * endpoint accepts them.
 */
export async function getBulkDeviceTimeSeries(
  pairs: { devID: string; sensor: string }[],
  startMs: number,
  endMs: number,
  downscale = 2000,
): Promise<Map<string, TimeSeriesPoint[]>> {
  if (pairs.length === 0) return new Map();

  const batches: { devID: string; sensor: string }[][] = [];
  for (let i = 0; i < pairs.length; i += BULK_TIME_SERIES_BATCH_SIZE) {
    batches.push(pairs.slice(i, i + BULK_TIME_SERIES_BATCH_SIZE));
  }

  // Low concurrency (2) + per-batch retry keeps the total request rate gentle enough that the
  // endpoint's intermittent under-load failures recover instead of failing the whole report.
  const batchResults = await runWithConcurrencyLimit(batches, 2, (batch) =>
    fetchBulkTimeSeriesBatchWithRetry(batch, startMs, endMs, downscale),
  );

  const merged = new Map<string, TimeSeriesPoint[]>();
  for (const batchResult of batchResults) {
    for (const [devID, points] of batchResult) merged.set(devID, points);
  }
  return merged;
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
