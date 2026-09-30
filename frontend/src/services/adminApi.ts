/**
 * Client for the backend admin API (served from the same origin under /api — see
 * backend/src/api/adminApi.ts). Unlike the other services in this folder, these calls go to OUR
 * backend, not to IOsense directly.
 */

export interface ReportLogEntry {
  time: string;
  reportType: 'weekly' | 'daily' | 'generated';
  section: string;
  status: 'sent' | 'failed' | 'skipped' | 'generation-failed' | 'generated';
  fileName?: string;
  recipients?: string[];
  error?: string;
  /** For on-demand `generated` reports: the custom range (ISO) the report covers. */
  rangeStart?: string;
  rangeEnd?: string;
  /** True when the file still exists on disk and its download URL will work. */
  downloadable: boolean;
}

export interface Section {
  key: string;
  name: string;
  /** Parent plant category — 'Refinery' | 'Petchem' | 'Unassigned'. Drives the cascading picker. */
  category: string;
}

export interface Schedule {
  key: string;
  name: string;
  type: 'daily' | 'weekly';
  sendTime: string;
  paused: boolean;
  recipients: string[];
  recipientsOverridden: boolean;
  lastRun?: { time: string; status: string; fileName?: string; error?: string };
}

export interface OverrideError {
  line: number;
  text: string;
  message: string;
}

export interface SchedulesResponse {
  pauseAll: boolean;
  overrideErrors: OverrideError[];
  schedules: Schedule[];
}

export interface GenerateJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  progressLabel: string;
  params: { unitKeys: string[]; start: string; end: string };
  files: { fileName: string; unitName: string }[];
  error?: string;
}

export interface OverridesValidation {
  pauseAll: boolean;
  pausedKeys: string[];
  recipients: Record<string, string[]>;
  errors: OverrideError[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export function fetchReportLog(filters: {
  type?: string;
  status?: string;
  section?: string;
  q?: string;
  limit?: number;
}): Promise<{ total: number; entries: ReportLogEntry[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return request(`/api/report-log?${params}`);
}

export function archiveDownloadUrl(fileName: string): string {
  return `/api/archive/${encodeURIComponent(fileName)}`;
}

export function generatedDownloadUrl(fileName: string): string {
  return `/api/generated/${encodeURIComponent(fileName)}`;
}

/** Correct download URL for a log row: on-demand reports come from /generated, emailed ones from /archive. */
export function downloadUrlForEntry(entry: ReportLogEntry): string {
  const isGenerated = entry.reportType === 'generated' || entry.status === 'generated';
  return isGenerated ? generatedDownloadUrl(entry.fileName!) : archiveDownloadUrl(entry.fileName!);
}

export function fetchSections(): Promise<{ sections: Section[] }> {
  return request('/api/sections');
}

export function startGeneration(unitKeys: string[], start: string, end: string): Promise<{ jobId: string }> {
  return request('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitKeys, start, end }),
  });
}

export function fetchJob(jobId: string): Promise<GenerateJob> {
  return request(`/api/generate/${jobId}`);
}

export function fetchSchedules(): Promise<SchedulesResponse> {
  return request('/api/schedules');
}

export function pauseAll(): Promise<{ ok: boolean }> {
  return request('/api/schedules/pause-all', { method: 'POST' });
}

export function resumeAll(): Promise<{ ok: boolean }> {
  return request('/api/schedules/resume-all', { method: 'POST' });
}

export function pauseSection(key: string): Promise<{ ok: boolean }> {
  return request(`/api/schedules/${encodeURIComponent(key)}/pause`, { method: 'POST' });
}

export function resumeSection(key: string): Promise<{ ok: boolean }> {
  return request(`/api/schedules/${encodeURIComponent(key)}/resume`, { method: 'POST' });
}

export function saveRecipients(key: string, type: 'daily' | 'weekly', recipients: string[] | null): Promise<{ ok: boolean }> {
  return request(`/api/schedules/${encodeURIComponent(key)}/recipients`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, recipients }),
  });
}

export const overridesExportUrl = '/api/overrides/export';

export function validateOverrides(text: string): Promise<OverridesValidation> {
  return request('/api/overrides/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function saveOverrides(text: string): Promise<OverridesValidation & { ok: boolean }> {
  return request('/api/overrides', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
