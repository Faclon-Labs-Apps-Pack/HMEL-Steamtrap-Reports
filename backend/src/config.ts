import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Personal Access Token, issued by an IOsense admin for service/automation use — no expiry, unlike the browser JWT. */
export function getAuthHeader(): string {
  const pat = requireEnv('IOSENSE_PAT');
  return pat.startsWith('Bearer ') ? pat : `Bearer ${pat}`;
}

/** Organisation ID the PAT acts on behalf of — required for service auth (unlike the browser JWT flow, which doesn't need it). */
export function getOrgId(): string {
  return requireEnv('IOSENSE_ORG_ID');
}

// The schedule values you put in .env (WEEKLY_REPORT_TIME / DAILY_REPORT_TIME etc.) are meant as IST wall-clock
// times regardless of what timezone the server itself boots in (many VMs default to UTC, which
// is 5.5 hours behind IST — without this, "20:20" in .env would fire at 20:20 UTC = 01:50 IST).
export const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE ?? 'Asia/Kolkata';

export const API_BASE = process.env.IOSENSE_API_BASE ?? 'https://connector.iosense.io/api';

// Deliberately NOT a bare relative path like './output' — that would resolve against
// process.cwd() at launch time, which varies by how the process is started (plain `npm start`
// from backend/, `npm start` from the repo root via --prefix, pm2, systemd, Docker — they don't
// all guarantee the same cwd). Anchored to this file's own location instead, so "generated but
// not where you're looking for it" can't happen regardless of how the process was launched.
export const OUTPUT_DIR = process.env.REPORT_OUTPUT_DIR ?? new URL('../output', import.meta.url).pathname;

// Where the report send-log is written (report-log.txt + report-log.jsonl). Anchored to this
// file's location like OUTPUT_DIR so it's found regardless of how the process is launched. Unlike
// output/, these files are NEVER deleted — they're the audit trail of what was sent / what failed.
export const LOG_DIR = process.env.REPORT_LOG_DIR ?? new URL('../logs', import.meta.url).pathname;

// Where the frontend's production build (`npm run build` in frontend/, Vite's default `dist/`
// output) lives, so the backend can serve it directly on the SAME port as the file server —
// one process, one port, no reverse-proxy path-routing to misconfigure. Computed relative to
// this file's own location (not process.cwd()) so it works regardless of where the process was
// launched from. Only used if the directory actually exists — see fileServer.ts.
export const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR ?? new URL('../../frontend/dist', import.meta.url).pathname;

/**
 * How many minutes before the configured schedule time the report should be generated (the
 * email itself still goes out exactly AT the schedule time — see `scheduler/scheduleReport.ts`).
 * Defaults to 15. E.g. scheduled for 10:10 with REPORT_LEAD_TIME_MINUTES=2 -> generation starts
 * at 10:08, email sends at 10:10.
 */
export const REPORT_LEAD_TIME_MINUTES = (() => {
  const raw = process.env.REPORT_LEAD_TIME_MINUTES;
  if (!raw) return 15;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`Invalid REPORT_LEAD_TIME_MINUTES "${raw}" — expected a non-negative number of minutes.`);
  }
  return minutes;
})();

function parseRecipients(name: string): string[] {
  const raw = process.env[name] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Env-var-safe key for a unit/category name: uppercased, runs of non-alphanumerics → a single underscore. E.g. "DFCU (AU)" -> "DFCU_AU", "Petchem Offsite" -> "PETCHEM_OFFSITE". */
export function envKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Recipients for ONE unit's Daily Report — its own designated list, e.g.
 *   "Petchem Offsite"  -> PETCHEM_OFFSITE_DAILY_RECIPIENTS
 *   "CPP-575"          -> CPP_575_DAILY_RECIPIENTS
 * (the legacy DAILY_REPORT_RECIPIENTS_<UNIT> name is still accepted). A unit without either
 * falls back to the shared DAILY_REPORT_RECIPIENTS.
 */
export function getDailyRecipientsForUnit(unitName: string): string[] {
  const key = envKey(unitName);
  const own = parseRecipients(`${key}_DAILY_RECIPIENTS`);
  if (own.length > 0) return own;
  const legacy = parseRecipients(`DAILY_REPORT_RECIPIENTS_${key}`);
  if (legacy.length > 0) return legacy;
  return parseRecipients('DAILY_REPORT_RECIPIENTS');
}

/** One section's own schedule: which key it covers, when it fires, and who receives it. */
export interface SectionSchedule {
  key: string; // envKey form, e.g. CPP_575 or REFINERY
  cron: string;
  recipients: string[];
}

/**
 * Units that have their OWN daily send time set via <UNITKEY>_DAILY_TIME (24-hour HH:MM) — each
 * is scheduled individually at that time, to its own <UNITKEY>_DAILY_RECIPIENTS (falling back to
 * the shared DAILY_REPORT_RECIPIENTS). Units WITHOUT their own time are generated together by the
 * shared DAILY_REPORT_TIME job instead (see getDailyDefaultCron).
 */
export function getDailyUnitSchedules(): SectionSchedule[] {
  const schedules: SectionSchedule[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^(.+)_DAILY_TIME$/.exec(name);
    if (!match || !value?.trim()) continue;
    const key = match[1];
    const own = parseRecipients(`${key}_DAILY_RECIPIENTS`);
    schedules.push({
      key,
      cron: dailyTimeToCron(value),
      recipients: own.length > 0 ? own : parseRecipients('DAILY_REPORT_RECIPIENTS'),
    });
  }
  return schedules;
}

/** The shared daily send time (DAILY_REPORT_TIME / DAILY_REPORT_CRON), for every unit without its own <UNIT>_DAILY_TIME. Null if not configured. */
export function getDailyDefaultCron(): string | null {
  const time = process.env.DAILY_REPORT_TIME;
  if (time?.trim()) return dailyTimeToCron(time);
  const cron = process.env.DAILY_REPORT_CRON;
  return cron?.trim() ? cron : null;
}

/**
 * A plant category's OWN weekly schedule via <CATEGORY>_WEEKLY_DAY + <CATEGORY>_WEEKLY_TIME
 * (e.g. REFINERY_WEEKLY_DAY=Mon, REFINERY_WEEKLY_TIME=06:00), sent to <CATEGORY>_WEEKLY_RECIPIENTS
 * (falling back to the shared WEEKLY_REPORT_RECIPIENTS). Null unless BOTH day and time are set —
 * such categories fall back to the shared WEEKLY_REPORT_DAY/TIME job (see getWeeklyDefaultCron).
 */
export function getWeeklyCategorySchedule(category: string): SectionSchedule | null {
  const key = envKey(category);
  const day = process.env[`${key}_WEEKLY_DAY`];
  const time = process.env[`${key}_WEEKLY_TIME`];
  if (!day?.trim() || !time?.trim()) return null;
  return { key, cron: weeklyDayTimeToCron(day, time), recipients: getWeeklyRecipientsForCategory(category) };
}

/** Recipients for one weekly category — its own <CATEGORY>_WEEKLY_RECIPIENTS, falling back to the shared WEEKLY_REPORT_RECIPIENTS. */
export function getWeeklyRecipientsForCategory(category: string): string[] {
  const own = parseRecipients(`${envKey(category)}_WEEKLY_RECIPIENTS`);
  return own.length > 0 ? own : parseRecipients('WEEKLY_REPORT_RECIPIENTS');
}

/** The shared weekly schedule (WEEKLY_REPORT_DAY/TIME or WEEKLY_REPORT_CRON), for every category without its own. Null if not configured. */
export function getWeeklyDefaultCron(): string | null {
  const day = process.env.WEEKLY_REPORT_DAY;
  const time = process.env.WEEKLY_REPORT_TIME;
  if (day?.trim() && time?.trim()) return weeklyDayTimeToCron(day, time);
  const cron = process.env.WEEKLY_REPORT_CRON;
  return cron?.trim() ? cron : null;
}

/** Converts a plain 24-hour "HH:MM" into an every-day cron expression ("M H * * *"). */
function dailyTimeToCron(time: string): string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new Error(`Invalid DAILY_REPORT_TIME "${time}" — expected 24-hour HH:MM, e.g. 06:00.`);
  }
  const [, hour, minute] = match;
  return `${Number(minute)} ${Number(hour)} * * *`;
}

const DAY_OF_WEEK: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Converts a weekday (ISO number 1-7 where 1=Monday … 7=Sunday, OR a name like "Monday"/"Mon",
 * case-insensitive) + plain 24-hour "HH:MM" into a weekly cron expression ("M H * * D"). The
 * cron day-of-week field is 0-6 (Sunday=0), so ISO 7 (Sunday) maps to cron 0.
 */
function weeklyDayTimeToCron(day: string, time: string): string {
  const trimmed = day.trim();
  let dow: number | undefined;
  if (/^\d+$/.test(trimmed)) {
    const iso = Number(trimmed); // ISO 8601: 1=Monday … 7=Sunday
    if (iso >= 1 && iso <= 7) dow = iso === 7 ? 0 : iso; // cron day-of-week: Sunday=0
  } else {
    dow = DAY_OF_WEEK[trimmed.toLowerCase()];
  }
  if (dow === undefined) {
    throw new Error(
      `Invalid WEEKLY_REPORT_DAY "${day}" — expected 1-7 (1=Monday … 7=Sunday) or a weekday name like Monday (or Mon).`,
    );
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new Error(`Invalid WEEKLY_REPORT_TIME "${time}" — expected 24-hour HH:MM, e.g. 06:00.`);
  }
  const [, hour, minute] = match;
  return `${Number(minute)} ${Number(hour)} * * ${dow}`;
}


/**
 * IOsense's `sendEmail` API fetches attachments by URL (pull-based, GET request from IOsense's
 * servers) rather than accepting uploaded bytes — see `src/email/sendReportEmail.ts`. This means
 * the file-serving port opened by `src/fileServer.ts` MUST be reachable from the public internet
 * (IOsense's servers need to reach it), not just localhost. Set this to your deployed service's
 * public base URL, e.g. https://your-service.example.com — a report generated locally with no
 * public URL will "send" successfully but arrive with broken/missing attachments, since IOsense
 * can never fetch them.
 */
export function getReportBaseUrl(): string {
  return requireEnv('REPORT_BASE_URL').replace(/\/$/, '');
}

// FILE_SERVER_PORT takes priority; PORT is the common convention process managers/deploy
// scripts set (pm2, systemd unit files, etc.) — honored as a fallback so you don't have to
// duplicate the same value under two different names on your VM.
export const FILE_SERVER_PORT = Number(process.env.FILE_SERVER_PORT ?? process.env.PORT ?? '3000');
