import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  getDailyRecipientsForUnit,
  getWeeklyRecipientsForCategory,
  getDailyUnitSchedules,
  getDailyDefaultCron,
  getWeeklyCategorySchedule,
  getWeeklyDefaultCron,
  getReportBaseUrl,
  getStatsIngestCron,
  isStatsCacheEnabled,
  isDeliveryGuardEnabled,
  getDeliveryConfirmWaitMs,
  getDailyCcForUnit,
  splitToAndCc,
  OUTPUT_DIR,
  ARCHIVE_DIR,
} from './config';
import { loadOverrides, isPaused, overrideRecipients, overrideCc } from './scheduler/overrides';
import { startFileServer } from './fileServer';
import { scheduleReport, longSetTimeout } from './scheduler/scheduleReport';
import { addPendingEmail, removePendingEmail, getPendingEmails, type PendingEmail } from './scheduler/pendingEmails';
import { logReport } from './scheduler/reportLog';
import { sendReportEmail } from './email/sendReportEmail';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { generateManagementReportWorkbooks } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbooks } from './reportGeneration/generateDailyReport';
import { findDevicesByType } from './services/iosenseApi';
import { ensureDaysIngested, ingestDay } from './services/dailyStatsStore';
import { MONITORING_START } from './lib/dateRange';
import { sendOpsAlert, isAuthError } from './services/alerting';
import { startFileServerWatchdog } from './scheduler/fileServerWatchdog';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';

/** Shared auth-failure hint — the PAT doesn't expire, so a 401 means it was rotated/revoked by an admin. */
function authHint(err: unknown): string {
  return isAuthError(err)
    ? 'LIKELY CAUSE: the IOSENSE_PAT was rotated/revoked (it does not expire on its own). Issue a fresh PAT, put it in .env, and restart the service with `pm2 restart <app> --update-env`.'
    : 'Check service logs and the IOsense getAutoDownSampledData endpoint. The daily-stats cache should keep this light — if it is a bulk-endpoint outage the run aborts rather than emailing a report full of false "No Status".';
}


/**
 * One report file (and one pending email) per plant category — see
 * generateManagementReportWorkbooks. Each category's email goes to its own designated
 * recipients (<CATEGORY>_WEEKLY_RECIPIENTS, falling back to the shared WEEKLY_REPORT_RECIPIENTS).
 * `opts.categories` restricts which categories this run generates, so a category with its own
 * <CATEGORY>_WEEKLY_DAY/TIME can be scheduled independently. The subject is the report/file name.
 */
async function generateWeekly(occurrence: Date, opts?: { categories?: string[] }): Promise<PendingEmail[]> {
  // PAUSE: ALL short-circuits BEFORE the expensive generation (per-section pauses are checked
  // per workbook below). Re-checked again after generation in case the file changed mid-run.
  if ((await loadOverrides()).pauseAll) {
    await logReport({
      reportType: 'weekly',
      section: opts?.categories?.join(', ') ?? '(all categories)',
      status: 'skipped',
      error: 'Paused via report-overrides.txt (PAUSE: ALL — resume from the admin UI)',
    });
    return [];
  }
  let reports;
  try {
    reports = await generateManagementReportWorkbooks((p) => console.log(`[weekly] ${p.label}`), opts);
  } catch (err) {
    await logReport({
      reportType: 'weekly',
      section: opts?.categories?.join(', ') ?? '(all categories)',
      status: 'generation-failed',
      error: err instanceof Error ? err.message : String(err),
    });
    await sendOpsAlert({
      subject: 'Weekly report generation FAILED',
      lines: [
        'Stage: generation — NO weekly emails were sent for this run.',
        `Scope: ${opts?.categories?.join(', ') ?? 'all categories'}`,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        authHint(err),
      ],
    });
    throw err;
  }

  // Runtime overrides (pause / recipient replacements) — re-read fresh at fire time, fail-open:
  // any problem loading them means plain .env behavior, never a stopped report.
  const overrides = await loadOverrides();

  const pendings: PendingEmail[] = [];
  for (const { categoryName, reportName, fileName, workbook } of reports) {
    if (isPaused(overrides, categoryName)) {
      await logReport({
        reportType: 'weekly',
        section: categoryName,
        status: 'skipped',
        fileName,
        error: 'Paused via report-overrides.txt (resume from the admin UI)',
      });
      continue;
    }
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    // Keep a permanent copy for the admin UI's View Reports tab (OUTPUT_DIR files are one-shot:
    // deleted when IOsense fetches them). An archive failure must never block the send.
    await saveWorkbook(workbook, ARCHIVE_DIR, fileName).catch((err) =>
      console.error(`[archive] Could not archive ${fileName} (send continues):`, err),
    );

    const recipients = overrideRecipients(overrides, categoryName, 'weekly') ?? getWeeklyRecipientsForCategory(categoryName);
    if (recipients.length === 0) {
      await logReport({
        reportType: 'weekly',
        section: categoryName,
        status: 'skipped',
        fileName,
        error: `No recipients configured (set ${categoryName.toUpperCase()}_WEEKLY_RECIPIENTS or WEEKLY_REPORT_RECIPIENTS)`,
      });
      continue;
    }

    const pending: PendingEmail = {
      reportType: 'weekly',
      section: categoryName,
      fileName,
      downloadUrl: `${getReportBaseUrl()}/report/${encodeURIComponent(fileName)}`,
      recipients,
      subject: reportName,
      reportTitle: 'Steam Trap Weekly Report',
      message:
        'Dear Team,\n\n' +
        `Your Steam Trap Weekly report for ${categoryName} has been generated successfully.\n\n` +
        'Report includes:\n' +
        '1. Performance Indicators (trap health, steam loss/savings — WTD/MTD/YTD)\n' +
        '2. Steam Trap Status by unit\n' +
        '3. Corrective Actions by unit (WTD/MTD/YTD)\n\n' +
        'Best Regards,\nHMEL Steam Trap Monitoring System',
      generatedAt: new Date().toISOString(),
      sendAt: occurrence.toISOString(),
    };
    await addPendingEmail(pending);
    pendings.push(pending);
  }
  return pendings;
}

/**
 * One report file (and one pending email) per unit — see generateDailyReportWorkbooks. Each
 * unit's email goes to that unit's designated recipients (<UNIT>_DAILY_RECIPIENTS, falling back
 * to the shared DAILY_REPORT_RECIPIENTS — see getDailyRecipientsForUnit). `opts` restricts which
 * units this run generates, so a unit with its own <UNIT>_DAILY_TIME can be scheduled
 * independently. The subject is the report/file name.
 */
async function generateDaily(
  occurrence: Date,
  opts?: { unitKeys?: string[]; excludeUnitKeys?: string[] },
): Promise<PendingEmail[]> {
  // PAUSE: ALL short-circuits BEFORE the expensive generation — see generateWeekly.
  if ((await loadOverrides()).pauseAll) {
    await logReport({
      reportType: 'daily',
      section: opts?.unitKeys?.join(', ') ?? '(all units)',
      status: 'skipped',
      error: 'Paused via report-overrides.txt (PAUSE: ALL — resume from the admin UI)',
    });
    return [];
  }
  let reports;
  try {
    reports = await generateDailyReportWorkbooks((p) => console.log(`[daily] ${p.label}`), opts);
  } catch (err) {
    await logReport({
      reportType: 'daily',
      section: opts?.unitKeys?.join(', ') ?? '(all units)',
      status: 'generation-failed',
      error: err instanceof Error ? err.message : String(err),
    });
    await sendOpsAlert({
      subject: 'Daily report generation FAILED',
      lines: [
        'Stage: generation — NO daily emails were sent for this run.',
        `Scope: ${opts?.unitKeys?.join(', ') ?? 'all units'}`,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        authHint(err),
      ],
    });
    throw err;
  }

  // Runtime overrides — same fail-open, fire-time semantics as the weekly path above.
  const overrides = await loadOverrides();

  const pendings: PendingEmail[] = [];
  for (const { unitName, reportName, fileName, workbook } of reports) {
    if (isPaused(overrides, unitName)) {
      await logReport({
        reportType: 'daily',
        section: unitName,
        status: 'skipped',
        fileName,
        error: 'Paused via report-overrides.txt (resume from the admin UI)',
      });
      continue;
    }
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    await saveWorkbook(workbook, ARCHIVE_DIR, fileName).catch((err) =>
      console.error(`[archive] Could not archive ${fileName} (send continues):`, err),
    );

    const configuredRecipients = overrideRecipients(overrides, unitName, 'daily') ?? getDailyRecipientsForUnit(unitName);
    if (configuredRecipients.length === 0) {
      await logReport({
        reportType: 'daily',
        section: unitName,
        status: 'skipped',
        fileName,
        error: `No recipients configured (set ${unitName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_DAILY_RECIPIENTS or DAILY_REPORT_RECIPIENTS)`,
      });
      continue;
    }
    // CC the common managers (shared DAILY_REPORT_CC + any unit-specific override) and move them out
    // of the primary To list, so they're copied — not listed as a To on every department's report.
    const configuredCc = overrideCc(overrides, unitName, 'daily') ?? getDailyCcForUnit(unitName);
    const { to: recipients, cc } = splitToAndCc(configuredRecipients, configuredCc);

    const pending: PendingEmail = {
      reportType: 'daily',
      section: unitName,
      fileName,
      downloadUrl: `${getReportBaseUrl()}/report/${encodeURIComponent(fileName)}`,
      recipients,
      cc,
      subject: reportName,
      reportTitle: 'Steam Trap Daily Report',
      message:
        'Dear Team,\n\n' +
        `Your Steam Trap Daily report for ${unitName} has been generated successfully.\n\n` +
        'Report includes:\n' +
        '1. Summary (status breakdown, aggregate counts)\n' +
        '2. Analysis (per-device status/change/action detail)\n' +
        '3. Live Status (pressure, temperature per device)\n\n' +
        'Best Regards,\nHMEL Steam Trap Monitoring System',
      generatedAt: new Date().toISOString(),
      sendAt: occurrence.toISOString(),
    };
    await addPendingEmail(pending);
    pendings.push(pending);
  }
  return pendings;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * PRE-FLIGHT reachability check: HEAD our own public /report URL (the exact URL + proxy IOsense will
 * pull from) so we never hand IOsense a dead URL. HEAD is NON-destructive on our file server (only a
 * real GET deletes the file — see fileServer.ts), so this is safe to run before every send. Retries a
 * few times over ~30s to ride out a transient blip. Returns true if a 2xx came back.
 */
async function isReportUrlReachable(url: string, attempts = 4): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (res.ok) return true;
      console.warn(`[delivery] pre-flight HEAD ${url} -> HTTP ${res.status} (attempt ${i + 1}/${attempts})`);
    } catch (err) {
      console.warn(`[delivery] pre-flight HEAD ${url} failed (attempt ${i + 1}/${attempts}): ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) await sleep(5_000);
  }
  return false;
}

/**
 * Was the report file consumed? Our file server deletes it ONLY after IOsense successfully downloads
 * it, so "file gone from OUTPUT_DIR" == "IOsense fetched it" == delivered. Still present after the
 * confirm window == IOsense never fetched == NOT delivered (safe to resend — a failed fetch means the
 * email never arrived, so there is no duplicate).
 */
function reportFileConsumed(fileName: string): boolean {
  return !existsSync(path.join(OUTPUT_DIR, fileName));
}

/** The actual IOsense sendEmail call for one pending report (shared by first send + resend). */
async function emailReport(pending: PendingEmail): Promise<void> {
  await sendReportEmail({
    to: pending.recipients,
    cc: pending.cc ?? [],
    subject: pending.subject,
    reportTitle: pending.reportTitle,
    message: pending.message,
    attachments: [{ url: pending.downloadUrl, fileName: pending.fileName }],
  });
}

/**
 * After a batch is sent, CONFIRM each report was actually fetched by IOsense (file consumed). Any
 * still sitting on disk after the confirm window was never downloaded → resend once (the file is
 * still there to fetch), wait again, and alert on anything still unfetched. This catches IOsense-side
 * fetch misses that a pre-flight check cannot — the failure mode behind "email never reached the
 * client" even though our side logged SENT.
 */
async function confirmBatchDelivery(sent: PendingEmail[]): Promise<void> {
  if (!isDeliveryGuardEnabled() || sent.length === 0) return;
  const waitMs = getDeliveryConfirmWaitMs();
  await sleep(waitMs);

  const notFetched = sent.filter((p) => !reportFileConsumed(p.fileName));
  if (notFetched.length === 0) {
    console.log(`[delivery] All ${sent.length} report(s) fetched by IOsense within ${waitMs / 1000}s — delivery confirmed.`);
    return;
  }
  console.warn(`[delivery] ${notFetched.length}/${sent.length} report(s) NOT fetched by IOsense after ${waitMs / 1000}s — resending.`);
  for (const pending of notFetched) {
    try {
      if (!(await isReportUrlReachable(pending.downloadUrl))) {
        console.error(`[delivery] resend skipped for ${pending.fileName}: public URL still unreachable.`);
        continue;
      }
      await emailReport(pending);
      await logReport({ reportType: pending.reportType, section: pending.section, status: 'sent', fileName: pending.fileName, recipients: pending.recipients });
      console.log(`[delivery] Resent ${pending.section} (${pending.fileName}).`);
    } catch (err) {
      console.error(`[delivery] Resend failed for ${pending.fileName}:`, err);
    }
  }

  await sleep(waitMs);
  const stillUnfetched = notFetched.filter((p) => !reportFileConsumed(p.fileName));
  if (stillUnfetched.length > 0) {
    await sendOpsAlert({
      subject: `${stillUnfetched.length} report(s) NOT delivered (IOsense never fetched the attachment)`,
      lines: [
        'These reports were sent AND resent, but IOsense never downloaded the attachment, so they did',
        'not reach recipients (the files are still on our server, unfetched):',
        ...stillUnfetched.map((p) => `• ${p.section} (${p.fileName})`),
        '',
        `Check the public report URL is reachable: ${getReportBaseUrl()}/api/health`,
      ],
    });
  }
}

/** Sends each unit's email independently — one unit failing doesn't block the others — then confirms IOsense actually fetched each. */
async function sendPendingList(pendings: PendingEmail[]): Promise<void> {
  const failures: { pending: PendingEmail; err: unknown }[] = [];
  const sent: PendingEmail[] = [];
  for (const pending of pendings) {
    try {
      await sendPending(pending);
      sent.push(pending);
    } catch (err) {
      console.error(`[sendPending] Send failed for ${pending.fileName} — continuing with the rest:`, err);
      failures.push({ pending, err });
    }
  }
  // Detection layer: if any report that was generated couldn't be emailed, alert immediately — the
  // run otherwise completes "quietly" and the gap is only noticed when a recipient complains.
  if (failures.length > 0) {
    const first = failures[0].err;
    await sendOpsAlert({
      subject: `${failures.length}/${pendings.length} report email(s) FAILED to send`,
      lines: [
        'Stage: send — these reports were generated but their emails did not go out:',
        ...failures.map((f) => `• ${f.pending.section} (${f.pending.fileName}): ${f.err instanceof Error ? f.err.message : String(f.err)}`),
        '',
        authHint(first),
      ],
    });
  }
  // Confirm IOsense actually downloaded each sent report; resend/alert on misses.
  await confirmBatchDelivery(sent);
}

/**
 * Verifies the file this pending email points at actually still exists on disk, at the expected
 * size, right before we tell IOsense to go fetch it. This is the last point in our own process
 * where we can catch a "missing/empty file" problem — anything after this (IOsense's own fetch,
 * DNS/routing to the wrong server) is outside our visibility, which is exactly why this check
 * matters: if this log shows a healthy file but the recipient still gets something empty/wrong,
 * that PROVES the bug is downstream of us (routing/deployment), not in our own file handling.
 */
async function verifyFileBeforeSend(fileName: string): Promise<void> {
  const filePath = path.join(OUTPUT_DIR, fileName);
  try {
    const { size } = await stat(filePath);
    console.log(`[sendPending] Pre-send check: ${filePath} exists, ${size} bytes`);
    if (size < 5000) {
      console.warn(`[sendPending] WARNING: ${filePath} is only ${size} bytes right before send — likely not a real report.`);
    }
  } catch (err) {
    console.error(`[sendPending] WARNING: ${filePath} does NOT exist at send time (already deleted, wrong OUTPUT_DIR, or never written):`, err);
  }
}

async function sendPending(pending: PendingEmail): Promise<void> {
  await verifyFileBeforeSend(pending.fileName);
  console.log(`[sendPending] Attachment URL IOsense will fetch: ${pending.downloadUrl}`);

  // PRE-FLIGHT: confirm IOsense can actually reach the attachment URL BEFORE we ask it to fetch.
  // HEAD is non-destructive (doesn't consume the one-shot file). If the URL is down, sending just
  // produces a silent non-delivery (sendEmail returns success regardless), so don't send — log,
  // alert, and leave the pending entry for recovery to retry once the URL is healthy again.
  if (isDeliveryGuardEnabled() && !(await isReportUrlReachable(pending.downloadUrl))) {
    const msg = `Public report URL not reachable before send — IOsense would fail to fetch the attachment: ${pending.downloadUrl}`;
    await logReport({ reportType: pending.reportType, section: pending.section, status: 'failed', fileName: pending.fileName, recipients: pending.recipients, error: msg });
    await sendOpsAlert({
      subject: `Report NOT sent — attachment URL unreachable (${pending.section})`,
      lines: [msg, 'Left pending for retry. Check the file server and the public /report URL health.'],
    });
    throw new Error(msg);
  }

  try {
    await emailReport(pending);
  } catch (err) {
    // Log the failure with its reason; leave the pending entry in place so startup recovery retries it.
    await logReport({
      reportType: pending.reportType,
      section: pending.section,
      status: 'failed',
      fileName: pending.fileName,
      recipients: pending.recipients,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  await removePendingEmail(pending.fileName);
  await logReport({
    reportType: pending.reportType,
    section: pending.section,
    status: 'sent',
    fileName: pending.fileName,
    recipients: pending.recipients,
  });
}

/**
 * On startup, resumes any report that was generated but never sent — e.g. the process restarted
 * (deploy, crash) between the generate phase (T-15min) and the send phase (T). Without this, a
 * pending-emails.json entry with no process watching it would just sit there forever. Overdue
 * entries (sendAt already passed) go out immediately; still-future ones get a fresh setTimeout
 * for the remaining delay.
 */
async function recoverPendingEmails(): Promise<void> {
  const pending = await getPendingEmails();
  for (const entry of pending) {
    const delayMs = Math.max(0, new Date(entry.sendAt).getTime() - Date.now());
    if (delayMs === 0) {
      console.log(`[scheduler] Recovering overdue pending email ${entry.fileName} (was due ${entry.sendAt}) — sending now.`);
    } else {
      console.log(`[scheduler] Recovering pending email ${entry.fileName} — sending at ${entry.sendAt} (in ${Math.round(delayMs / 60000)} min).`);
    }
    longSetTimeout(async () => {
      try {
        await sendPending(entry);
        console.log(`[scheduler] Recovered send complete for ${entry.fileName}.`);
      } catch (err) {
        console.error(`[scheduler] Recovered send FAILED for ${entry.fileName}:`, err);
      }
    }, delayMs);
  }
}

/**
 * Nightly daily-stats pre-ingest. Runs AFTER the day completes (STATS_INGEST_TIME, default 00:30
 * IST) and BEFORE the morning reports, so the report's cache path finds every day already stored and
 * does ZERO heavy live S1 work on its critical path. This is the structural fix for the flaky
 * getAutoDownSampledData endpoint: the only S1 load left anywhere is one light 24h fetch per day,
 * done here off the report's deadline. Fills any gaps since MONITORING_START (idempotent) and
 * force-refreshes the just-completed day so a partial earlier ingest can't leave a stuck bucket.
 * Fail-open: a failure alerts + reschedules; the report's own ensureDaysIngested still self-heals.
 */
async function runDailyStatsIngest(): Promise<void> {
  if (!isStatsCacheEnabled()) {
    console.log('[stats-ingest] Cache disabled (STATS_CACHE_ENABLED=false) — skipping pre-ingest.');
    return;
  }
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { ingested, skipped } = await ensureDaysIngested(devices, MONITORING_START, yesterday, (m) =>
    console.log(`[stats-ingest] ${m}`),
  );
  await ingestDay(devices, yesterday); // force-refresh the just-completed day for a guaranteed-complete bucket
  console.log(
    `[stats-ingest] Done through ${yesterday.toDateString()} — ${devices.length} devices, ${ingested} day(s) ingested, ${skipped} already present.`,
  );
}

/** Wraps the pre-ingest so a failure alerts but never crashes the scheduler. */
async function runDailyStatsIngestSafe(): Promise<void> {
  try {
    await runDailyStatsIngest();
  } catch (err) {
    console.error('[stats-ingest] FAILED:', err);
    await sendOpsAlert({
      subject: 'Nightly daily-stats pre-ingest FAILED',
      lines: [
        'The overnight cache pre-ingest failed. Reports can still self-heal at generation time, but',
        'this is an early warning that the S1 endpoint (or auth) is unhealthy before the morning run.',
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        authHint(err),
      ],
    });
  }
}

/** The two client-defined weekly categories (each its own parent unit in the report). */
const WEEKLY_CATEGORIES = ['Refinery', 'Petchem'];

async function main() {
  startFileServer();
  // Guard against the file server silently losing its socket (as on 2026-10-08→12): if our own
  // /report URL becomes unreachable, alert and self-restart so attachments stay fetchable.
  startFileServerWatchdog();
  await recoverPendingEmails();

  // --- Daily-stats pre-ingest: keep the cache warm off the report's critical path (see
  // runDailyStatsIngest). Reuses the two-phase scheduler with a no-op "send" — the ingest IS the work.
  if (isStatsCacheEnabled()) {
    const ingestCron = getStatsIngestCron();
    if (ingestCron) {
      console.log(`[scheduler] Daily-stats pre-ingest: ${ingestCron} (STATS_INGEST_TIME).`);
      scheduleReport('stats-ingest', ingestCron, async () => runDailyStatsIngestSafe(), async () => {});
    }
  } else {
    console.log('[scheduler] Daily-stats cache DISABLED — pre-ingest not scheduled (reports will live-sweep).');
  }

  // --- Weekly: each category on its own <CATEGORY>_WEEKLY_DAY/TIME if set, else grouped under
  // the shared WEEKLY_REPORT_DAY/TIME.
  const weeklyDefaultCategories: string[] = [];
  for (const category of WEEKLY_CATEGORIES) {
    const sched = getWeeklyCategorySchedule(category);
    if (sched) {
      console.log(`[scheduler] Weekly ${category}: individual schedule (${sched.cron}).`);
      scheduleReport(`weekly:${category}`, sched.cron, (occ) => generateWeekly(occ, { categories: [category] }), sendPendingList);
    } else {
      weeklyDefaultCategories.push(category);
    }
  }
  const weeklyDefaultCron = getWeeklyDefaultCron();
  if (weeklyDefaultCategories.length > 0 && weeklyDefaultCron) {
    console.log(`[scheduler] Weekly ${weeklyDefaultCategories.join(', ')}: shared schedule (${weeklyDefaultCron}).`);
    scheduleReport('weekly', weeklyDefaultCron, (occ) => generateWeekly(occ, { categories: weeklyDefaultCategories }), sendPendingList);
  } else if (weeklyDefaultCategories.length > 0) {
    console.warn(
      `[scheduler] No weekly schedule for ${weeklyDefaultCategories.join(', ')} — set <CATEGORY>_WEEKLY_DAY/TIME or WEEKLY_REPORT_DAY/TIME.`,
    );
  }

  // --- Daily: each unit with its own <UNIT>_DAILY_TIME is scheduled individually; every other
  // unit is generated together by the shared DAILY_REPORT_TIME job.
  const unitSchedules = getDailyUnitSchedules();
  for (const s of unitSchedules) {
    console.log(`[scheduler] Daily ${s.key}: individual schedule (${s.cron}).`);
    scheduleReport(`daily:${s.key}`, s.cron, (occ) => generateDaily(occ, { unitKeys: [s.key] }), sendPendingList);
  }
  const dailyDefaultCron = getDailyDefaultCron();
  if (dailyDefaultCron) {
    const excludeUnitKeys = unitSchedules.map((s) => s.key);
    console.log(`[scheduler] Daily (all other units): shared schedule (${dailyDefaultCron}).`);
    scheduleReport('daily', dailyDefaultCron, (occ) => generateDaily(occ, { excludeUnitKeys }), sendPendingList);
  } else if (unitSchedules.length === 0) {
    console.warn('[scheduler] No daily schedule configured — set <UNIT>_DAILY_TIME or DAILY_REPORT_TIME.');
  }

  console.log('[scheduler] Running. Press Ctrl+C to stop.');
}

main();
