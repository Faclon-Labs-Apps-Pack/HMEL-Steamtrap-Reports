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

async function getFeedbackCount(devID: string): Promise<number> {
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
    if (body.errors?.some((e) => /no feedback found/i.test(e))) return 0;
    throw new ApiError(`Failed to fetch feedback count for ${devID}: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }
  if (!response.ok || !body.data) {
    throw new ApiError(`Failed to fetch feedback count for ${devID}.`);
  }

  return body.data.data.length;
}

/**
 * Feedback records use a different query shape than corrective actions: a single `devID`
 * (not a batched `trapDeviceIDs` array), so this is one request per device, concurrency-limited.
 * Only `createdAt` exists on a feedback record (no separate event-time field like corrective
 * actions' `dateAndTime`), so this is NOT date-filtered — it's an all-time count.
 */
export async function getFeedbackCountsByDevice(devices: Device[]): Promise<Map<string, number>> {
  const results = await runWithConcurrencyLimit(devices, 10, async (device) => {
    const count = await getFeedbackCount(device.devID);
    return [device.devID, count] as const;
  });

  return new Map(results);
}
