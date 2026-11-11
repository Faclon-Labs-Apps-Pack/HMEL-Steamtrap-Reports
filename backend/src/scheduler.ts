import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  getDailyRecipientsForUnit,
  getWeeklyRecipientsForCategory,
  getReportBaseUrl,
  getStatsIngestCron,
  isStatsCacheEnabled,
  isDeliveryGuardEnabled,
  getDeliveryConfirmWaitMs,
  getDailyCcForUnit,
  splitToAndCc,
  dailyUnitKeysFromEnv,
  OUTPUT_DIR,
  ARCHIVE_DIR,
} from './config';
import { loadOverrides, isPaused, overrideRecipients, overrideCc } from './scheduler/overrides';
import {
  buildDailyCronGroups,
  buildWeeklyCronGroups,
  effectiveCycleTime,
  getCycleDayRange,
  DEFAULT_CYCLE_TIME,
} from './scheduler/effectiveSchedule';
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
 * Runs the daily generation for a unit scope, honoring per-unit CYCLE TIMES (the data-day boundary,
 * editable from the admin UI's Schedule tab): units at the default 00:00:00 cycle go through one
 * batch exactly as before (cache path untouched), while each distinct non-midnight cycle gets its
 * own workbook call with that cycle's 24h window (yesterday@cycle -> today@cycle). An exclude-style
 * scope (the shared job) keeps covering units that exist only as device tags.
 */
async function generateDailyWithCycles(opts?: { unitKeys?: string[]; excludeUnitKeys?: string[] }) {
  const log = (p: { label: string }) => console.log(`[daily] ${p.label}`);
  const overrides = await loadOverrides();
  const known = dailyUnitKeysFromEnv();
  const inScope = (key: string) =>
    opts?.unitKeys ? opts.unitKeys.includes(key) : !(opts?.excludeUnitKeys ?? []).includes(key);

  // Distinct non-default cycles among the in-scope known units.
  const cycleGroups = new Map<string, string[]>();
  for (const key of known.filter(inScope)) {
    const cycle = effectiveCycleTime(key, overrides);
    if (cycle === DEFAULT_CYCLE_TIME) continue;
    cycleGroups.set(cycle, [...(cycleGroups.get(cycle) ?? []), key]);
  }

  const reports = [];
  for (const [cycle, unitKeys] of cycleGroups) {
    console.log(`[daily] Cycle ${cycle} units (${unitKeys.join(', ')}): window ${getCycleDayRange(cycle).start.toISOString()} -> ${getCycleDayRange(cycle).end.toISOString()}`);
    reports.push(...(await generateDailyReportWorkbooks(log, { unitKeys, cycleRange: getCycleDayRange(cycle) })));
  }

  // Everyone else — the default-midnight batch, exactly the pre-cycle behavior.
  const cycledKeys = [...cycleGroups.values()].flat();
  if (opts?.unitKeys) {
    const remainder = opts.unitKeys.filter((k) => !cycledKeys.includes(k));
    if (remainder.length > 0) reports.push(...(await generateDailyReportWorkbooks(log, { unitKeys: remainder })));
  } else {
    reports.push(
      ...(await generateDailyReportWorkbooks(log, { excludeUnitKeys: [...(opts?.excludeUnitKeys ?? []), ...cycledKeys] })),
    );
  }
  return reports;
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
    reports = await generateDailyWithCycles(opts);
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

// ---------------------------------------------------------------------------
// Schedule reconciler — makes invocation (send) times live-editable
// ---------------------------------------------------------------------------
//
// Send times used to be fixed at boot (.env only). The admin UI now writes send-time / cycle-time
// overrides into report-overrides.txt, so the scheduler re-derives the cron groups from
// (env + overrides) every RECONCILE_INTERVAL_MS and starts/stops jobs to match — an edited time
// takes effect within a minute, no restart, the same fire-time semantics recipients have.
//
// Jobs are keyed purely by cron; MEMBERSHIP (which units/categories fire on that cron) is
// recomputed fresh at generation time, so a unit moving between two existing crons needs no job
// churn at all. A retired job soft-stops: an occurrence already generating still completes its
// send (see scheduleReport.stop()), and the shared per-job-name occurrence guard prevents a
// stopped+recreated job from double-sending. Edits landing inside a job's ~15-min generate->send
// window apply from the next occurrence.

const RECONCILE_INTERVAL_MS = 60_000;

const activeDailyJobs = new Map<string, ReturnType<typeof scheduleReport>>();
const activeWeeklyJobs = new Map<string, ReturnType<typeof scheduleReport>>();

/** Generates for whichever units resolve to `cron` AT FIRE TIME (membership never goes stale). */
async function generateDailyForCron(occ: Date, cron: string): Promise<PendingEmail[]> {
  const groups = buildDailyCronGroups(await loadOverrides());
  const group = groups.get(cron);
  if (!group) {
    console.log(`[scheduler] daily@${cron}: no units resolve to this cron anymore — nothing to generate.`);
    return [];
  }
  if (group.isDefault) {
    // The catch-all batch: everyone except units that now fire on some other cron (device-tag-only
    // units are not in any group's unitKeys and so always ride with the default job — as always).
    const excludeUnitKeys = [...groups.values()].filter((g) => !g.isDefault).flatMap((g) => g.unitKeys);
    return generateDaily(occ, { excludeUnitKeys });
  }
  return generateDaily(occ, { unitKeys: group.unitKeys });
}

/** Generates for whichever weekly categories resolve to `cron` at fire time. */
async function generateWeeklyForCron(occ: Date, cron: string): Promise<PendingEmail[]> {
  const groups = buildWeeklyCronGroups(await loadOverrides());
  const group = groups.get(cron);
  if (!group) {
    console.log(`[scheduler] weekly@${cron}: no categories resolve to this cron anymore — nothing to generate.`);
    return [];
  }
  return generateWeekly(occ, { categories: group.categories });
}

/** Diffs the live (env + overrides) cron set against the running jobs and starts/stops to match. */
async function reconcileSchedules(): Promise<void> {
  const overrides = await loadOverrides();

  const desiredDaily = buildDailyCronGroups(overrides);
  for (const [cron, job] of activeDailyJobs) {
    if (!desiredDaily.has(cron)) {
      console.log(`[scheduler] Retiring daily job @ "${cron}" (send time edited away).`);
      job.stop();
      activeDailyJobs.delete(cron);
    }
  }
  for (const [cron, group] of desiredDaily) {
    if (activeDailyJobs.has(cron)) continue;
    console.log(
      `[scheduler] Daily @ "${cron}"${group.isDefault ? ' (shared default)' : ` for ${group.unitKeys.join(', ')}`}.`,
    );
    activeDailyJobs.set(
      cron,
      scheduleReport(`daily@${cron}`, cron, (occ) => generateDailyForCron(occ, cron), sendPendingList),
    );
  }
  if (desiredDaily.size === 0 && activeDailyJobs.size === 0) {
    console.warn('[scheduler] No daily schedule configured — set <UNIT>_DAILY_TIME or DAILY_REPORT_TIME.');
  }

  const desiredWeekly = buildWeeklyCronGroups(overrides);
  for (const [cron, job] of activeWeeklyJobs) {
    if (!desiredWeekly.has(cron)) {
      console.log(`[scheduler] Retiring weekly job @ "${cron}" (send time edited away).`);
      job.stop();
      activeWeeklyJobs.delete(cron);
    }
  }
  for (const [cron, group] of desiredWeekly) {
    if (activeWeeklyJobs.has(cron)) continue;
    console.log(`[scheduler] Weekly @ "${cron}" for ${group.categories.join(', ')}.`);
    activeWeeklyJobs.set(
      cron,
      scheduleReport(`weekly@${cron}`, cron, (occ) => generateWeeklyForCron(occ, cron), sendPendingList),
    );
  }
  if (desiredWeekly.size === 0 && activeWeeklyJobs.size === 0) {
    console.warn('[scheduler] No weekly schedule configured — set <CATEGORY>_WEEKLY_DAY/TIME or WEEKLY_REPORT_DAY/TIME.');
  }
}

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

  // --- Daily + weekly jobs: derived from .env LAYERED WITH the overrides file and re-reconciled
  // every minute, so send-time edits from the admin UI apply without a restart (see the
  // reconciler block above).
  await reconcileSchedules();
  setInterval(() => {
    reconcileSchedules().catch((err) => console.error('[scheduler] Reconcile failed (keeping current jobs):', err));
  }, RECONCILE_INTERVAL_MS);

  console.log('[scheduler] Running. Press Ctrl+C to stop.');
}

main();
