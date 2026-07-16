import { getAuthHeader, getOrgId } from '../config';
import { ApiError } from './iosenseApi';

const TRAP_REPLACEMENT_API_BASE = 'https://appserver.iosense.io/api';

export interface CorrectiveActionRecord {
  devId: string;
  devName: string;
  location: string;
  manufacturer: string;
  trapSize: string;
  failure: string;
  /** When the corrective action actually happened (as opposed to `createdAt`, when the record was logged). */
  dateAndTime: string;
  correctiveAction: string;
  remark: string;
}

interface TrapReplacementFilterResponse {
  success: boolean;
  data?: {
    data: CorrectiveActionRecord[];
    totalCount: number;
  };
  errors?: string[];
}

/**
 * Fetches every corrective-action (trap replacement) record for the given devices,
 * paginating past the endpoint's default page size, then filters client-side to the
 * given time window (the endpoint's `search` filtering isn't documented/reliable, and
 * corrective-action logs are low-volume so pulling everything and filtering is cheap).
 */
export async function getCorrectiveActions(
  deviceIDs: string[],
  range?: { startMs: number; endMs: number },
): Promise<CorrectiveActionRecord[]> {
  if (deviceIDs.length === 0) return [];

  const limit = 200;
  let skip = 1;
  const records: CorrectiveActionRecord[] = [];

  while (true) {
    const response = await fetch(`${TRAP_REPLACEMENT_API_BASE}/account/trapReplacement/filter/${skip}/${limit}`, {
      method: 'PUT',
      headers: {
        Authorization: getAuthHeader(),
        organisation: getOrgId(),
        'Content-Type': 'application/json',
        'ngsw-bypass': 'true',
      },
      body: JSON.stringify({
        isFeedback: false,
        search: {},
        trapDeviceIDs: deviceIDs,
      }),
    });

    const body = (await response.json()) as TrapReplacementFilterResponse;

    if (!body.success) {
      if (body.errors?.some((e) => /no trapreplacement found/i.test(e))) {
        return records;
      }
      throw new ApiError(`Failed to fetch corrective actions: ${body.errors?.join(', ') ?? 'unknown error'}`);
    }
    if (!response.ok || !body.data) {
      throw new ApiError('Failed to fetch corrective actions from IOsense.');
    }

    records.push(...body.data.data);

    if (records.length >= body.data.totalCount || body.data.data.length < limit) {
      break;
    }
    skip += 1;
  }

  if (!range) return records;

  return records.filter((record) => {
    const t = new Date(record.dateAndTime).getTime();
    return t >= range.startMs && t <= range.endMs;
  });
}
