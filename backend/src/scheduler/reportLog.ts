import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { LOG_DIR, REPORT_TIMEZONE } from '../config';

/**
 * What happened to one report on one scheduled run:
 *  - sent              → email accepted by IOsense for that section
 *  - failed            → send attempt errored (reason captured)
 *  - skipped           → report generated but not emailed (e.g. no recipients configured)
 *  - generation-failed → the report couldn't even be built (data fetch / API error)
 */
export type ReportLogStatus = 'sent' | 'failed' | 'skipped' | 'generation-failed';

export interface ReportLogEntry {
  reportType: 'weekly' | 'daily';
  /** The unit (daily) or plant category (weekly); '(generation)' for a whole-batch build failure. */
  section: string;
  status: ReportLogStatus;
  fileName?: string;
  recipients?: string[];
  /** Failure reason, for failed / generation-failed. */
  error?: string;
}

const LOG_TXT = path.join(LOG_DIR, 'report-log.txt');
const LOG_JSONL = path.join(LOG_DIR, 'report-log.jsonl');

/** Wall-clock timestamp in the report timezone (IST), e.g. "2026-08-24 15:15:03 IST". */
function timestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} IST`;
}

/**
 * Appends one entry to the report send-log — both a human-readable `report-log.txt` (open it to
 * read what was sent / what failed and why) and a machine-readable `report-log.jsonl` (one JSON
 * object per line, for programmatic parsing). Never throws: a logging failure must not break a
 * send. Also echoes the line to stdout so it shows up in pm2 logs.
 */
export async function logReport(entry: ReportLogEntry): Promise<void> {
  const ts = timestamp();
  const line =
    `[${ts}] ${entry.status.toUpperCase().padEnd(16)} ${entry.reportType.padEnd(6)} | ${entry.section} | ${entry.fileName ?? '-'}` +
    (entry.recipients && entry.recipients.length > 0 ? ` | to: ${entry.recipients.join(', ')}` : '') +
    (entry.error ? ` | reason: ${entry.error}` : '');

  console.log(`[reportLog] ${line}`);
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_TXT, line + '\n');
    await appendFile(LOG_JSONL, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    console.error('[reportLog] Could not write the log file (continuing anyway):', err);
  }
}
