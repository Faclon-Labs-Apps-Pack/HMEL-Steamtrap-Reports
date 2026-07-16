import { CronExpressionParser } from 'cron-parser';
import { REPORT_TIMEZONE, REPORT_LEAD_TIME_MINUTES } from '../config';

const LEAD_TIME_MS = REPORT_LEAD_TIME_MINUTES * 60 * 1000;

/**
 * The cron expression's next actual fire instant strictly after `after`. Interpreted in
 * REPORT_TIMEZONE (IST by default), not the server's own local timezone — so `.env` values match
 * wall-clock IST regardless of where this is deployed.
 */
function nextOccurrence(cron: string, after: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: after, tz: REPORT_TIMEZONE }).next().toDate();
}

/** Next time `cron` fires, minus the configured lead time (REPORT_LEAD_TIME_MINUTES), computed relative to `now`. */
export function nextRunTime(cron: string, now: Date = new Date()): Date {
  return new Date(nextOccurrence(cron, now).getTime() - LEAD_TIME_MS);
}

/**
 * Schedules a report in two phases, forever, via self-rescheduling `setTimeout` chains (not a
 * fixed interval — cron occurrences aren't evenly spaced once weekly/monthly patterns are
 * involved):
 *
 * 1. At T-leadTime (REPORT_LEAD_TIME_MINUTES, default 15): `generate(occurrence)` builds the
 *    report, saves it, and returns whatever `send` needs (recipients, attachment URL, etc).
 *    Generation should finish well within the lead time, so this phase exists purely as a safety
 *    buffer, NOT as "send early" — the email must go out at the actual configured time, not
 *    whenever generation happens to finish.
 * 2. At T (the real cron instant): `send(payload)` actually emails the report.
 *
 * If `generate` throws, the error is logged and the next occurrence is scheduled — no send is
 * attempted. If `send` throws, same thing — one bad run doesn't kill all future runs.
 *
 * IMPORTANT: rescheduling after a cycle completes must search strictly after the occurrence just
 * handled, not merely after "now" — see the note that used to be here about the immediate-refire
 * trap this avoids.
 */
export function scheduleReport<T>(
  name: string,
  cron: string,
  generate: (occurrence: Date) => Promise<T>,
  send: (payload: T) => Promise<void>,
): void {
  function scheduleNext(after: Date = new Date()) {
    const occurrence = nextOccurrence(cron, after);
    const generateAt = new Date(occurrence.getTime() - LEAD_TIME_MS);
    const generateDelayMs = Math.max(0, generateAt.getTime() - Date.now());
    console.log(
      `[scheduler:${name}] Next generate at ${generateAt.toISOString()}, send at ${occurrence.toISOString()} ` +
        `(in ${Math.round(generateDelayMs / 60000)} min)`,
    );

    setTimeout(async () => {
      console.log(`[scheduler:${name}] Generating…`);
      let payload: T;
      try {
        payload = await generate(occurrence);
      } catch (err) {
        console.error(`[scheduler:${name}] Generation failed:`, err);
        scheduleNext(occurrence);
        return;
      }

      const sendDelayMs = Math.max(0, occurrence.getTime() - Date.now());
      console.log(`[scheduler:${name}] Report ready — sending at ${occurrence.toISOString()} (in ${Math.round(sendDelayMs / 60000)} min)`);

      setTimeout(async () => {
        console.log(`[scheduler:${name}] Sending…`);
        try {
          await send(payload);
          console.log(`[scheduler:${name}] Done.`);
        } catch (err) {
          console.error(`[scheduler:${name}] Send failed:`, err);
        } finally {
          scheduleNext(occurrence);
        }
      }, sendDelayMs);
    }, generateDelayMs);
  }

  scheduleNext();
}
