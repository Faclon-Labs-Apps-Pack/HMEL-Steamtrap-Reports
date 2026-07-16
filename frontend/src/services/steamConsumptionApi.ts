import { getStoredToken } from '../auth/auth';
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
  data?: { steamMonthly: number };
  errors?: string[];
}

/**
 * Calls `steamConsumptionCustom` for one sensor across the given devices and returns the
 * summed consumption. The endpoint only returns one aggregate total for whatever device list
 * is sent (no per-device breakdown), so per-device figures require one call per device.
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
      Authorization: getStoredToken(),
      'Content-Type': 'application/json',
      'ngsw-bypass': 'true',
    },
    body: JSON.stringify({
      devices,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
    }),
  });

  const body: SteamConsumptionCustomResponse = await response.json();

  if (!body.success) {
    throw new ApiError(`Failed to fetch steam consumption: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }
  if (!response.ok || !body.data) {
    throw new ApiError('Failed to fetch steam consumption from IOsense.');
  }

  return body.data.steamMonthly;
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
