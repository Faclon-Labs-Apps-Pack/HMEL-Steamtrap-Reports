import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  OUTPUT_DIR,
  ARCHIVE_DIR,
  getAttachmentMaxAttempts,
  getAttachmentRetryWindowMs,
  getAttachmentRetryIntervalMs,
  getReportBaseUrl,
} from '../config';
import { sendOpsAlert, isAuthError } from '../services/alerting';
import { isQuotaError, isAttachmentError } from '../email/sendReportEmail';
import { logReport } from './reportLog';
import { restorePendingEmail, type PendingEmail } from './pendingEmails';
import { longSetTimeout } from './scheduleReport';

/**
 * What happens when a report email doesn't go out — IOsense's sendEmail now tells us WHY, and the
 * two failures it reports need opposite handling:
 *
 *  - "Not sending email due to no quota"      → NOTHING we can do on our side and every report in
 *    the run is hitting the same wall, so don't burn attempts: log it, keep the report queued, and
 *    alert the admins straight away so a human can get the quota raised/reset.
 *
 *  - "Error: Error in getting attachment data" → IOsense couldn't GET our /report URL. That is OUR
 *    side and it is usually transient (file server restarting, proxy blip, file not written yet), so
 *    the same send will succeed unchanged a few minutes later: send it again on a timer, up to
 *    ATTACHMENT_MAX_ATTEMPTS times (default 2 — the original plus one retry), and only alert once
 *    those are spent. The same treatment covers our own pre-flight finding the URL unreachable —
 *    identical root cause, caught one step earlier.
 *
 *  - anything else → alert now; we have no recovery story for an unclassified rejection.
 *
 * Alerts are BATCHED (see `queueAlert`): a quota outage or a dead file server fails every unit in
 * the run, and 20 near-identical emails is worse monitoring than one email listing 20 reports.
 */

/** How long to collect same-kind failures before emailing the admins, so one outage = one alert. */
const ALERT_BATCH_MS = 60_000;

type AlertKind = 'quota' | 'gave-up' | 'unknown';

interface AlertBatch {
  lines: string[];
  /** Kept so an auth-looking failure can add its hint to the email. */
  hint?: string;
}

const batches = new Map<AlertKind, AlertBatch>();

/**
 * Adds one report's failure to the pending alert for its kind, starting a timer on the first one.
 * Everything that fails in the next ALERT_BATCH_MS lands in the same email.
 */
function queueAlert(kind: AlertKind, line: string, hint?: string): void {
  const open = batches.get(kind);
  if (open) {
    open.lines.push(line);
    open.hint ??= hint;
    return;
  }
  const batch: AlertBatch = { lines: [line], hint };
  batches.set(kind, batch);
  const timer = setTimeout(() => {
    batches.delete(kind);
    void flushAlert(kind, batch);
  }, ALERT_BATCH_MS);
  timer.unref?.(); // never hold the process open just for a pending alert
}

async function flushAlert(kind: AlertKind, batch: AlertBatch): Promise<void> {
  const n = batch.lines.length;
  const maxAttempts = getAttachmentMaxAttempts();

  const { subject, intro } =
    kind === 'quota'
      ? {
          subject: `EMAIL QUOTA EXHAUSTED — ${n} report email(s) NOT sent`,
          intro: [
            'IOsense refused to send because the account is out of email quota ("Not sending email',
            'due to no quota"). This is fleet-wide and nothing on our side will fix it — the reports',
            'below were generated but NOT delivered:',
          ],
        }
      : kind === 'gave-up'
        ? {
            subject: `${n} report(s) NOT delivered after ${maxAttempts} attempt(s)`,
            intro: [
              'IOsense could not fetch the report attachment from our public /report URL. Each report',
              `below was sent up to ${maxAttempts} time(s) and still did not go out:`,
            ],
          }
        : {
            subject: `${n} report email(s) FAILED to send`,
            intro: ['These reports were generated but IOsense rejected the send:'],
          };

  await sendOpsAlert({
    subject,
    lines: [
      ...intro,
      '',
      ...batch.lines,
      '',
      ...(kind === 'quota'
        ? ['Once the quota is restored, resend the batch with `npm run resend:daily` / `npm run resend:weekly`.']
        : []),
      ...(kind === 'gave-up'
        ? [
            `Check the file server and the public report URL: ${getReportBaseUrl()}/api/health`,
            'The report files are still in the archive, so a resend will work once the URL is healthy.',
          ]
        : []),
      ...(batch.hint ? [batch.hint] : []),
    ],
  });
}

/**
 * Puts the report file back in OUTPUT_DIR from the archive if it's missing, so a retry has something
 * for IOsense to fetch. OUTPUT_DIR files are one-shot (the file server deletes each one once it has
 * been served), and a report that was never written is exactly why a fetch would fail.
 */
async function ensureReportFileAvailable(fileName: string): Promise<void> {
  const live = path.join(OUTPUT_DIR, fileName);
  if (existsSync(live)) return;
  const archived = path.join(ARCHIVE_DIR, fileName);
  if (!existsSync(archived)) {
    console.warn(`[retry] ${fileName} is in neither OUTPUT_DIR nor the archive — the retry will fail the pre-flight.`);
    return;
  }
  try {
    await copyFile(archived, live);
    console.log(`[retry] Restored ${fileName} from the archive for another attempt.`);
  } catch (err) {
    console.error(`[retry] Could not restore ${fileName} from the archive:`, err);
  }
}

/** The send to re-attempt — `sendPending` in scheduler.ts, injected to keep this module importable. */
export type RetrySend = (pending: PendingEmail) => Promise<unknown>;

/** Retries waiting on a timer, so they can be disarmed — on shutdown, and between tests. */
const armedRetries = new Set<{ cancel: () => void }>();

/** Disarms every pending retry. The reports stay queued, so startup recovery picks them up again. */
export function cancelArmedRetries(): void {
  for (const handle of armedRetries) handle.cancel();
  armedRetries.clear();
}

/**
 * Records an attachment failure and either schedules another attempt or gives up and alerts.
 *
 * Two independent stops, whichever comes first:
 *  - the attempt cap (ATTACHMENT_MAX_ATTEMPTS, default 2 — the original send plus one retry), and
 *  - the time backstop, measured from the FIRST failure (`firstFailureAt`, persisted on the queue
 *    entry) so restarts can't quietly extend the retry window into the next run.
 * A retry is only armed when it is within BOTH.
 */
export async function recordAttachmentFailure(pending: PendingEmail, reason: string, retry: RetrySend): Promise<void> {
  const firstFailureAt = pending.firstFailureAt ?? new Date().toISOString();
  const attempts = (pending.attempts ?? 0) + 1;
  const next: PendingEmail = { ...pending, attempts, firstFailureAt };

  const maxAttempts = getAttachmentMaxAttempts();
  const windowMs = getAttachmentRetryWindowMs();
  const intervalMs = getAttachmentRetryIntervalMs();
  const elapsedMs = Date.now() - new Date(firstFailureAt).getTime();
  const common = {
    reportType: pending.reportType,
    section: pending.section,
    fileName: pending.fileName,
    recipients: pending.recipients,
    attempt: attempts,
  } as const;

  if (attempts < maxAttempts && elapsedMs + intervalMs <= windowMs) {
    const inMin = Math.round(intervalMs / 60000);
    await restorePendingEmail(next); // stays queued: a restart mid-retry resumes the same countdown
    await logReport({
      ...common,
      status: 'retrying',
      error: `${reason} — retrying in ${inMin} min (attempt ${attempts + 1} of ${maxAttempts})`,
    });
    const handle = longSetTimeout(() => {
      armedRetries.delete(handle);
      void retryOnce(next, retry);
    }, intervalMs);
    armedRetries.add(handle);
    return;
  }

  // Out of attempts (or out of time): this report is not going out without a human.
  const spent = attempts >= maxAttempts ? `all ${maxAttempts} attempt(s)` : `${attempts} attempt(s)`;
  const overMin = Math.round(elapsedMs / 60000);
  await logReport({ ...common, status: 'failed', error: `${reason} — gave up after ${spent}` });
  queueAlert('gave-up', `• ${pending.section} (${pending.fileName}) — ${spent} over ${overMin} min: ${reason}`);
}

async function retryOnce(pending: PendingEmail, retry: RetrySend): Promise<void> {
  console.log(`[retry] Re-sending ${pending.fileName} (attempt ${(pending.attempts ?? 0) + 1})…`);
  await ensureReportFileAvailable(pending.fileName);
  try {
    await retry(pending);
  } catch {
    // The failure was already classified and logged by the send path — this retry's own outcome
    // decides whether another one is armed, so there is nothing to do here but not crash the timer.
  }
}

/** Records a quota failure: no retry (nothing on our side to fix), admins alerted right away. */
export async function recordQuotaFailure(pending: PendingEmail, reason: string): Promise<void> {
  await restorePendingEmail(pending); // keep it queued so a resend after the reset can pick it up
  await logReport({
    reportType: pending.reportType,
    section: pending.section,
    status: 'failed',
    fileName: pending.fileName,
    recipients: pending.recipients,
    error: reason,
  });
  queueAlert('quota', `• ${pending.section} (${pending.fileName}) → ${pending.recipients.length} recipient(s)`);
}

/** Records an unclassified rejection: no recovery story, so log it and alert. */
export async function recordUnknownFailure(pending: PendingEmail, reason: string, err?: unknown): Promise<void> {
  await restorePendingEmail(pending);
  await logReport({
    reportType: pending.reportType,
    section: pending.section,
    status: 'failed',
    fileName: pending.fileName,
    recipients: pending.recipients,
    error: reason,
  });
  queueAlert(
    'unknown',
    `• ${pending.section} (${pending.fileName}): ${reason}`,
    isAuthError(err ?? reason)
      ? 'LIKELY CAUSE: the IOSENSE_PAT was rotated/revoked. Issue a fresh PAT, put it in .env, and restart with `pm2 restart <app> --update-env`.'
      : undefined,
  );
}

/**
 * Single entry point for a failed send: classifies the error and routes it to the right handling.
 * `reason` is already-human-readable text (the SendEmailError message carries IOsense's own wording).
 */
export async function recordSendFailure(pending: PendingEmail, err: unknown, retry: RetrySend): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  if (isAttachmentError(err)) return recordAttachmentFailure(pending, reason, retry);
  if (isQuotaError(err)) return recordQuotaFailure(pending, reason);
  return recordUnknownFailure(pending, reason, err);
}
