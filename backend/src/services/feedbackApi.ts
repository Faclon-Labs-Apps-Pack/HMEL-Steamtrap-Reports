import { getAuthHeader, getOrgId } from '../config';
import { runWithConcurrencyLimit } from '../lib/concurrency';
import { ApiError } from './iosenseApi';
import type { Device } from '../types/device';

const TRAP_REPLACEMENT_API_BASE = 'https://appserver.iosense.io/api';

interface FeedbackRecord {
  _id: string;
  devId: string;
  feedback: string;
  createdAt: string;
}

interface FeedbackFilterResponse {
  success: boolean;
  // Confirmed live: the successful shape is `{success:true, data:{data:[...]}}` — NO
  // `totalCount` field, unlike the corrective-action mode of this same endpoint. Count via
  // `data.data.length`, not a totalCount that doesn't exist.
  data?: { data: FeedbackRecord[] };
  errors?: string[];
}

/** All feedback-record `createdAt` timestamps (epoch ms) for one device, so callers can count per time-window client-side. */
async function getFeedbackDates(devID: string): Promise<number[]> {
  const response = await fetch(`${TRAP_REPLACEMENT_API_BASE}/account/trapReplacement/filter/1/200`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(),
      organisation: getOrgId(),
      'Content-Type': 'application/json',
      'ngsw-bypass': 'true',
    },
    body: JSON.stringify({ isFeedback: true, search: {}, devID }),
  });

  const body = (await response.json()) as FeedbackFilterResponse;

  if (!body.success) {
    if (body.errors?.some((e) => /no feedback found/i.test(e))) return [];
    throw new ApiError(`Failed to fetch feedback for ${devID}: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }
  if (!response.ok || !body.data) {
    throw new ApiError(`Failed to fetch feedback for ${devID}.`);
  }

  return body.data.data.map((r) => new Date(r.createdAt).getTime()).filter((t) => Number.isFinite(t));
}

/**
 * Feedback records use a different query shape than corrective actions: a single `devID`
 * (not a batched `trapDeviceIDs` array), so this is one request per device, concurrency-limited.
 * Returns each device's feedback `createdAt` timestamps (epoch ms) — callers derive all-time
 * counts (`.length`) or per-window counts (filter by timestamp) from these, so the whole feedback
 * history is fetched only once. Capped at 200 records/device by the endpoint's page size.
 */
export async function getFeedbackDatesByDevice(devices: Device[]): Promise<Map<string, number[]>> {
  const results = await runWithConcurrencyLimit(devices, 10, async (device) => {
    const dates = await getFeedbackDates(device.devID);
    return [device.devID, dates] as const;
  });

  return new Map(results);
}

/** Convenience: all-time feedback count per device, derived from {@link getFeedbackDatesByDevice}. */
export async function getFeedbackCountsByDevice(devices: Device[]): Promise<Map<string, number>> {
  const datesByDevID = await getFeedbackDatesByDevice(devices);
  return new Map([...datesByDevID].map(([devID, dates]) => [devID, dates.length]));
}
