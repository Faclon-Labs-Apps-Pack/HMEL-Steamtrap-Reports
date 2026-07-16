import { getReportScheduleConfig, getReportBaseUrl, OUTPUT_DIR } from './config';
import { startFileServer } from './fileServer';
import { scheduleReport } from './scheduler/scheduleReport';
import { addPendingEmail, removePendingEmail, getPendingEmails, type PendingEmail } from './scheduler/pendingEmails';
import { sendReportEmail } from './email/sendReportEmail';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { generateManagementReportWorkbook } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbook } from './reportGeneration/generateDailyReport';

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function formattedDate(): string {
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

async function generateManagement(occurrence: Date): Promise<PendingEmail> {
  const { recipients } = getReportScheduleConfig('management');
  const workbook = await generateManagementReportWorkbook((p) => console.log(`[management] ${p.label}`));
  const fileName = `Steam-Trap-Management-Report_${dateStamp()}.xlsx`;
  await saveWorkbook(workbook, OUTPUT_DIR, fileName);

  const pending: PendingEmail = {
    reportType: 'management',
    fileName,
    downloadUrl: `${getReportBaseUrl()}/report/${fileName}`,
    recipients,
    subject: `[HMEL Management Report] Automated Report - ${formattedDate()}`,
    reportTitle: 'HMEL Steam Trap Management Report',
    message:
      'Dear Team,\n\n' +
      'Your Steam Trap Management report has been generated successfully.\n\n' +
      'Report includes:\n' +
      '1. Unit vs Trap Status by Plant Category (Refinery/Petchem)\n' +
      '2. Per-device detail for each category\n' +
      '3. Corrective Action Log\n\n' +
      'Best Regards,\nHMEL Steam Trap Monitoring System',
    generatedAt: new Date().toISOString(),
    sendAt: occurrence.toISOString(),
  };
  await addPendingEmail(pending);
  return pending;
}

async function generateDaily(occurrence: Date): Promise<PendingEmail> {
  const { recipients } = getReportScheduleConfig('daily');
  const workbook = await generateDailyReportWorkbook((p) => console.log(`[daily] ${p.label}`));
  const fileName = `Steam-Trap-Daily-Report_${dateStamp()}.xlsx`;
  await saveWorkbook(workbook, OUTPUT_DIR, fileName);

  const pending: PendingEmail = {
    reportType: 'daily',
    fileName,
    downloadUrl: `${getReportBaseUrl()}/report/${fileName}`,
    recipients,
    subject: `[HMEL Daily Report] Automated Report - ${formattedDate()}`,
    reportTitle: 'HMEL Steam Trap Daily Report',
    message:
      'Dear Team,\n\n' +
      'Your Steam Trap Daily report has been generated successfully.\n\n' +
      'Report includes:\n' +
      '1. Summary (status breakdown, aggregate counts)\n' +
      '2. Analysis (per-device status/change/action detail)\n' +
      '3. Live Status (pressure, temperature per device)\n\n' +
      'Best Regards,\nHMEL Steam Trap Monitoring System',
    generatedAt: new Date().toISOString(),
    sendAt: occurrence.toISOString(),
  };
  await addPendingEmail(pending);
  return pending;
}

async function sendPending(pending: PendingEmail): Promise<void> {
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
    setTimeout(async () => {
      try {
        await sendPending(entry);
        console.log(`[scheduler] Recovered send complete for ${entry.fileName}.`);
      } catch (err) {
        console.error(`[scheduler] Recovered send FAILED for ${entry.fileName}:`, err);
      }
    }, delayMs);
  }
}

async function main() {
  startFileServer();
  await recoverPendingEmails();

  const management = getReportScheduleConfig('management');
  const daily = getReportScheduleConfig('daily');

  scheduleReport('management', management.cron, generateManagement, sendPending);
  scheduleReport('daily', daily.cron, generateDaily, sendPending);

  console.log('[scheduler] Running. Press Ctrl+C to stop.');
}

main();
