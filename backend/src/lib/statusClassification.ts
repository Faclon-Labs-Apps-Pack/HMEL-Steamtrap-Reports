/**
 * The S1 sensor reports a numeric trap-status code. Updated per client 2026-10-26:
 *   1 = Normal, 3 = Normal (was "Flooding" — now counted as Normal), 5 = Valve Closed,
 *   6 = Choking, 7 = No Status, 8 = Offline, 9 = Leak.
 * Codes 2 and 4 are legacy (Mild Flooding / Mild Leak) and kept only for backward safety — the
 * current algorithm emits the codes above. Flooding is no longer a reported status (code 3 → Normal).
 */
export const STATUS_CODE_MAP: Record<number, string> = {
  1: 'Normal',
  2: 'Mild Flooding', // legacy, not emitted by the current algorithm
  3: 'Normal', // was Heavy Flooding; client 2026-10-26: code 3 now counts as Normal
  4: 'Mild Leak', // legacy, not emitted by the current algorithm
  5: 'Valve Closed',
  6: 'Choking',
  7: 'No Status',
  8: 'Offline', // client 2026-10-26: code 8 = Offline (previously undefined → fell back to No Status)
  9: 'Heavy Leak', // displayed/grouped as "Leak"
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
 * Flooding statuses are DROPPED ENTIRELY from every report (client request 2026-10-16): no Flooding
 * column anywhere, and flooding readings/traps are excluded from all counts, percentages and totals
 * so the remaining statuses reconcile among themselves. This is the single source of truth for
 * "what counts as flooding" — exclude these wherever a denominator or bucket is built.
 */
export const FLOODING_STATUSES: StatusColumn[] = ['Mild Flooding', 'Heavy Flooding'];

/** True if a status is a (dropped) flooding state. */
export function isFloodingStatus(status: StatusColumn): boolean {
  return FLOODING_STATUSES.includes(status);
}

/**
 * Collapsed status buckets for the weekly Management Report's Unit vs Trap Status matrix, per
 * the client template ("report templates/ManagementReportFormat for Steam Traps (1) (1).xlsx"):
 * Choked | Flooding | Normal | Leak | No Status | Offline. Mild/Heavy variants fold into one
 * column; Valve Closed has no column of its own in the template, so it counts under "No Status"
 * (the trap reports but isn't operating) rather than being silently dropped from the Total.
 */
export const GROUPED_STATUS_COLUMNS: { label: string; statuses: StatusColumn[] }[] = [
  { label: 'Choked', statuses: ['Choking'] },
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
