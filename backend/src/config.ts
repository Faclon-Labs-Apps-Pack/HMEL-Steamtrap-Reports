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

export interface ReportScheduleConfig {
  cron: string;
  recipients: string[];
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

/**
 * Converts a day-of-month (1-28) + plain 24-hour "HH:MM" into a monthly cron expression
 * ("M H D * *"). Capped at 28 (not 31) so it fires reliably every single month regardless of
 * February or 30-day months — a date like 30 would silently skip February entirely.
 */
function monthlyDateTimeToCron(day: string, time: string): string {
  const dayNum = Number(day);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 28) {
    throw new Error(
      `Invalid MONTHLY_REPORT_DATE "${day}" — expected an integer from 1 to 28 (capped at 28 so it exists in every month, including February).`,
    );
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new Error(`Invalid MONTHLY_REPORT_TIME "${time}" — expected 24-hour HH:MM, e.g. 06:00.`);
  }
  const [, hour, minute] = match;
  return `${Number(minute)} ${Number(hour)} ${dayNum} * *`;
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
 * Lazy on purpose — the one-shot `npm run generate` command doesn't need scheduling/email
 * config at all, only the scheduler daemon does. Eagerly reading these at module load would
 * make `generate` require env vars it has no use for.
 */
export function getReportScheduleConfig(report: 'weekly' | 'daily' | 'monthly'): ReportScheduleConfig {
  switch (report) {
    case 'daily': {
      // Daily report has no day-of-week component, so a plain time is enough — DAILY_REPORT_TIME
      // is preferred; DAILY_REPORT_CRON still works for anyone who wants a raw cron expression.
      const time = process.env.DAILY_REPORT_TIME;
      return {
        cron: time ? dailyTimeToCron(time) : requireEnv('DAILY_REPORT_CRON'),
        recipients: parseRecipients('DAILY_REPORT_RECIPIENTS'),
      };
    }
    case 'monthly': {
      // Monthly report needs a day-of-month + time — MONTHLY_REPORT_DATE + MONTHLY_REPORT_TIME
      // are preferred; MONTHLY_REPORT_CRON still works for anyone who wants a raw cron expression
      // (e.g. to express something monthlyDateTimeToCron can't, like "last day of the month").
      const day = process.env.MONTHLY_REPORT_DATE;
      const time = process.env.MONTHLY_REPORT_TIME;
      return {
        cron: day && time ? monthlyDateTimeToCron(day, time) : requireEnv('MONTHLY_REPORT_CRON'),
        recipients: parseRecipients('MONTHLY_REPORT_RECIPIENTS'),
      };
    }
    case 'weekly':
    default: {
      // Weekly report needs a day-of-week + time — WEEKLY_REPORT_DAY + WEEKLY_REPORT_TIME are
      // preferred; WEEKLY_REPORT_CRON still works for anyone who wants a raw cron expression.
      const day = process.env.WEEKLY_REPORT_DAY;
      const time = process.env.WEEKLY_REPORT_TIME;
      return {
        cron: day && time ? weeklyDayTimeToCron(day, time) : requireEnv('WEEKLY_REPORT_CRON'),
        recipients: parseRecipients('WEEKLY_REPORT_RECIPIENTS'),
      };
    }
  }
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
