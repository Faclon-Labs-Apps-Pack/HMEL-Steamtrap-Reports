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

const FEEDBACK_TIMEOUT_MS = 30_000; // abort a hung request instead of waiting on undici's default header timeout
const FEEDBACK_MAX_ATTEMPTS = 3; // retry transient network/timeout errors before giving up on a device
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One feedback request for a device, with an explicit abort timeout. */
async function fetchFeedbackDatesOnce(devID: string): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS);
  try {
    const response = await fetch(`${TRAP_REPLACEMENT_API_BASE}/account/trapReplacement/filter/1/200`, {
      method: 'PUT',
      headers: {
        Authorization: getAuthHeader(),
        organisation: getOrgId(),
        'Content-Type': 'application/json',
        'ngsw-bypass': 'true',
      },
      body: JSON.stringify({ isFeedback: true, search: {}, devID }),
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

/** All feedback-record `createdAt` timestamps (epoch ms) for one device — retried on transient failures. */
async function getFeedbackDates(devID: string): Promise<number[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FEEDBACK_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchFeedbackDatesOnce(devID);
    } catch (err) {
      lastErr = err;
      if (attempt < FEEDBACK_MAX_ATTEMPTS) await sleep(1000 * attempt);
    }
  }
  throw lastErr;
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
    try {
      return [device.devID, await getFeedbackDates(device.devID)] as const;
    } catch (err) {
      // Feedback count is a minor column — never let a transient feedback-endpoint failure abort
      // the whole report. Degrade this device's count to 0 and carry on. (This is what caused a
      // full daily-run failure on 2026-09-23: a single feedback headers-timeout aborted all units.)
      console.warn(`[feedback] ${device.devID}: giving up after ${FEEDBACK_MAX_ATTEMPTS} attempts, defaulting to 0 — ${(err as Error).message}`);
      return [device.devID, [] as number[]] as const;
    }
  });

  return new Map(results);
}

/** Convenience: all-time feedback count per device, derived from {@link getFeedbackDatesByDevice}. */
export async function getFeedbackCountsByDevice(devices: Device[]): Promise<Map<string, number>> {
  const datesByDevID = await getFeedbackDatesByDevice(devices);
  return new Map([...datesByDevID].map(([devID, dates]) => [devID, dates.length]));
}
