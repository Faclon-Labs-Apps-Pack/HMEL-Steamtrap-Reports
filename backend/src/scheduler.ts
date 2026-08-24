import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  getDailyRecipientsForUnit,
  getWeeklyRecipientsForCategory,
  getDailyUnitSchedules,
  getDailyDefaultCron,
  getWeeklyCategorySchedule,
  getWeeklyDefaultCron,
  getReportBaseUrl,
  OUTPUT_DIR,
} from './config';
import { startFileServer } from './fileServer';
import { scheduleReport, longSetTimeout } from './scheduler/scheduleReport';
import { addPendingEmail, removePendingEmail, getPendingEmails, type PendingEmail } from './scheduler/pendingEmails';
import { sendReportEmail } from './email/sendReportEmail';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { generateManagementReportWorkbooks } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbooks } from './reportGeneration/generateDailyReport';


/**
 * One report file (and one pending email) per plant category — see
 * generateManagementReportWorkbooks. Each category's email goes to its own designated
 * recipients (<CATEGORY>_WEEKLY_RECIPIENTS, falling back to the shared WEEKLY_REPORT_RECIPIENTS).
 * `opts.categories` restricts which categories this run generates, so a category with its own
 * <CATEGORY>_WEEKLY_DAY/TIME can be scheduled independently. The subject is the report/file name.
 */
async function generateWeekly(occurrence: Date, opts?: { categories?: string[] }): Promise<PendingEmail[]> {
  const reports = await generateManagementReportWorkbooks((p) => console.log(`[weekly] ${p.label}`), opts);

  const pendings: PendingEmail[] = [];
  for (const { categoryName, reportName, fileName, workbook } of reports) {
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);

    const recipients = getWeeklyRecipientsForCategory(categoryName);
    if (recipients.length === 0) {
      console.warn(
        `[weekly] No recipients configured for ${categoryName} (set ${categoryName.toUpperCase()}_WEEKLY_RECIPIENTS or WEEKLY_REPORT_RECIPIENTS) — report saved but no email will be sent.`,
      );
      continue;
    }

    const pending: PendingEmail = {
      reportType: 'weekly',
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
  const reports = await generateDailyReportWorkbooks((p) => console.log(`[daily] ${p.label}`), opts);

  const pendings: PendingEmail[] = [];
  for (const { unitName, reportName, fileName, workbook } of reports) {
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);

    const recipients = getDailyRecipientsForUnit(unitName);
    if (recipients.length === 0) {
      console.warn(
        `[daily] No recipients configured for unit "${unitName}" (set DAILY_REPORT_RECIPIENTS_* or DAILY_REPORT_RECIPIENTS) — report saved but no email will be sent.`,
      );
      continue;
    }

    const pending: PendingEmail = {
      reportType: 'daily',
      fileName,
      downloadUrl: `${getReportBaseUrl()}/report/${encodeURIComponent(fileName)}`,
      recipients,
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

/** Sends each unit's daily email independently — one unit failing doesn't block the others. */
async function sendPendingList(pendings: PendingEmail[]): Promise<void> {
  for (const pending of pendings) {
    try {
      await sendPending(pending);
    } catch (err) {
      console.error(`[sendPending] Send failed for ${pending.fileName} — continuing with the rest:`, err);
    }
  }
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
  await sendReportEmail({
    to: pending.recipients,
    subject: pending.subject,
    reportTitle: pending.reportTitle,
    message: pending.message,
    attachments: [{ url: pending.downloadUrl, fileName: pending.fileName }],
  });
  await removePendingEmail(pending.fileName);
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

/** The two client-defined weekly categories (each its own parent unit in the report). */
const WEEKLY_CATEGORIES = ['Refinery', 'Petchem'];

async function main() {
  startFileServer();
  await recoverPendingEmails();

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
