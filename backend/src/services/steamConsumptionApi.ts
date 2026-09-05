import { getAuthHeader, getOrgId } from '../config';
import { runWithConcurrencyLimit } from '../lib/concurrency';
import { ApiError } from './iosenseApi';
import type { Device } from '../types/device';

const TRAP_REPLACEMENT_API_BASE = 'https://appserver.iosense.io/api';

/** "Steam Loss Value" sensor. */
const STEAM_LOSS_SENSOR = 'D11';
/** "Steam Saving Value" sensor. */
const STEAM_SAVING_SENSOR = 'D12';

interface SteamConsumptionCustomResponse {
  success: boolean;
  // The API returns the aggregate in `steamConsumptionTotal` (KG). `steamConsumption` used to be
  // that same number but is now an object keyed by devID ({ "<devID>": <kg> }) — hence we read the
  // Total (falling back to summing the per-device map, then the legacy number form).
  data?: {
    steamConsumption?: number | Record<string, number>;
    steamConsumptionTotal?: number;
  };
  errors?: string[];
}

/**
 * Calls `steamConsumptionCustom` for one sensor across the given devices and returns the single
 * aggregate consumption the endpoint reports for that whole device list (there is NO per-device
 * breakdown in the response — the aggregate over the batch is NOT the same as the sum of
 * per-device calls, confirmed live). The response field is `steamConsumption`; `timezone` is
 * sent so the window is bucketed in IST, matching the dashboard's own call. The API returns the
 * value in KG — we divide by 1000 to return MT, the unit every report/sheet expects (final
 * 2-decimal rounding happens at display time via `.toFixed(2)`).
 */
async function getSteamConsumptionCustom(
  devices: { devID: string; sensorId: string }[],
  startMs: number,
  endMs: number,
): Promise<number> {
  if (devices.length === 0) return 0;

  const response = await fetch(`${TRAP_REPLACEMENT_API_BASE}/account/trapReplacement/steamConsumptionCustom`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(),
      organisation: getOrgId(),
      'Content-Type': 'application/json',
      'ngsw-bypass': 'true',
    },
    body: JSON.stringify({
      devices,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      timezone: 'Asia/Kolkata',
    }),
  });

  const body = (await response.json()) as SteamConsumptionCustomResponse;

  if (!body.success) {
    throw new ApiError(`Failed to fetch steam consumption: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }
  if (!response.ok || !body.data) {
    throw new ApiError('Failed to fetch steam consumption from IOsense.');
  }

  // Read the aggregate KG for the requested devices. Prefer `steamConsumptionTotal`; fall back to
  // summing the per-device `steamConsumption` map (current format), then the legacy plain-number
  // form. Missing/non-finite -> 0 so it never poisons a cell/total with NaN.
  const d = body.data;
  let kg: number;
  if (typeof d.steamConsumptionTotal === 'number') {
    kg = d.steamConsumptionTotal;
  } else if (d.steamConsumption && typeof d.steamConsumption === 'object') {
    kg = Object.values(d.steamConsumption).reduce((sum, v) => sum + (Number(v) || 0), 0);
  } else if (typeof d.steamConsumption === 'number') {
    kg = d.steamConsumption; // legacy response shape
  } else {
    kg = 0;
  }
  return Number.isFinite(kg) ? kg / 1000 : 0; // API returns KG; reports use MT
}

/**
 * Single batched call — the aggregate consumption for ALL given devices at once, for one sensor
 * (D11 loss / D12 saving). This is what the Weekly/Monthly section overview sheets use: one call
 * per plant-category section, matching the dashboard's own batched number (which differs from the
 * per-device sum). Pass the full list of devices in a section.
 */
export async function getSteamConsumptionTotal(
  devices: Device[],
  sensorId: string,
  startMs: number,
  endMs: number,
): Promise<number> {
  return getSteamConsumptionCustom(
    devices.map((d) => ({ devID: d.devID, sensorId })),
    startMs,
    endMs,
  );
}

/** Per-device Steam Loss (D11) totals for the given window, concurrency-limited (one call per device). */
export async function getSteamLossByDevice(
  devices: Device[],
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const results = await runWithConcurrencyLimit(devices, 10, async (device) => {
    const value = await getSteamConsumptionCustom([{ devID: device.devID, sensorId: STEAM_LOSS_SENSOR }], startMs, endMs);
    return [device.devID, value] as const;
  });

  return new Map(results);
}

/** Per-device Steam Saving (D12) totals for the given window, concurrency-limited (one call per device). */
export async function getSteamSavingByDevice(
  devices: Device[],
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const results = await runWithConcurrencyLimit(devices, 10, async (device) => {
    const value = await getSteamConsumptionCustom([{ devID: device.devID, sensorId: STEAM_SAVING_SENSOR }], startMs, endMs);
    return [device.devID, value] as const;
  });

  return new Map(results);
}
