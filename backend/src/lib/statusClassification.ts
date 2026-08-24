/**
 * The S1 sensor reports a numeric trap-status code (confirmed by the client 2026-07-16).
 * Note: code 8 is intentionally absent from the source system.
 */
export const STATUS_CODE_MAP: Record<number, string> = {
  1: 'Normal',
  2: 'Mild Flooding',
  3: 'Heavy Flooding',
  4: 'Mild Leak',
  5: 'Valve Closed',
  6: 'Choking',
  7: 'No Status',
  9: 'Heavy Leak',
};

/** Column order for the Unit vs Trap Status matrix: healthy first, then escalating fault severity, then unclassifiable/absent. */
export const STATUS_COLUMNS = [
  'Normal',
  'Mild Flooding',
  'Heavy Flooding',
  'Mild Leak',
  'Heavy Leak',
  'Choking',
  'Valve Closed',
  'No Status',
  'Offline',
] as const;
export type StatusColumn = (typeof STATUS_COLUMNS)[number];

/**
 * Collapsed status buckets for the weekly Management Report's Unit vs Trap Status matrix, per
 * the client template ("report templates/ManagementReportFormat for Steam Traps (1) (1).xlsx"):
 * Choked | Flooding | Normal | Leak | No Status | Offline. Mild/Heavy variants fold into one
 * column; Valve Closed has no column of its own in the template, so it counts under "No Status"
 * (the trap reports but isn't operating) rather than being silently dropped from the Total.
 */
export const GROUPED_STATUS_COLUMNS: { label: string; statuses: StatusColumn[] }[] = [
  { label: 'Choked', statuses: ['Choking'] },
  { label: 'Flooding', statuses: ['Mild Flooding', 'Heavy Flooding'] },
  { label: 'Normal', statuses: ['Normal'] },
  { label: 'Leak', statuses: ['Mild Leak', 'Heavy Leak'] },
  { label: 'No Status', statuses: ['No Status', 'Valve Closed'] },
  { label: 'Offline', statuses: ['Offline'] },
];

/**
 * Maps a raw S1 sensor reading (numeric code 1-7,9) to one of the report's fixed status
 * buckets. A device with no last data point at all (never reported) is Offline — distinct
 * from code 7 "No Status", which means the algorithm *did* run but couldn't classify.
 * An unrecognized code (e.g. a future addition) falls back to "No Status" with a warning
 * rather than being silently dropped.
 */
export function classifyStatus(rawValue: number | string | undefined): StatusColumn {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return 'Offline';
  }

  const code = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (Number.isNaN(code)) {
    console.warn(`[classifyStatus] Non-numeric S1 value, treating as No Status:`, rawValue);
    return 'No Status';
  }

  const label = STATUS_CODE_MAP[code];
  if (!label) {
    console.warn(`[classifyStatus] Unrecognized status code ${code}, treating as No Status.`);
    return 'No Status';
  }

  return label as StatusColumn;
}
