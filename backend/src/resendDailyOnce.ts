import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { OUTPUT_DIR, getDailyRecipientsForUnit, getReportBaseUrl } from './config';
import { generateDailyReportWorkbooks } from './reportGeneration/generateDailyReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { sendReportEmail } from './email/sendReportEmail';
import { logReport } from './scheduler/reportLog';

/**
 * One-off manual resend of the FULL daily batch (all units), used to recover a day whose scheduled
 * 08:05 run failed (e.g. 2026-09-23, aborted by a feedback headers-timeout). Mirrors the scheduler's
 * generateDaily + sendPendingList flow exactly: generate every unit, save to OUTPUT_DIR (served by
 * the already-running pm2 fileServer), then email each unit to its own recipients, per-unit isolated
 * so one failure doesn't block the rest. Daily data window is unchanged (previous full calendar day).
 */
async function main(): Promise<void> {
  console.log('[resend] Generating full daily batch (all units)…');
  const reports = await generateDailyReportWorkbooks((p) => console.log(`[resend] ${p.label}`));

  console.log(`[resend] Generated ${reports.length} unit reports. Sending…`);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const { unitName, reportName, fileName, workbook } of reports) {
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);

    const recipients = getDailyRecipientsForUnit(unitName);
    if (recipients.length === 0) {
      skipped++;
      await logReport({ reportType: 'daily', section: unitName, status: 'skipped', fileName, error: 'No recipients configured' });
      console.warn(`[resend] SKIP ${unitName} — no recipients`);
      continue;
    }

    const downloadUrl = `${getReportBaseUrl()}/report/${encodeURIComponent(fileName)}`;
    try {
      const { size } = await stat(path.join(OUTPUT_DIR, fileName));
      if (size < 5000) console.warn(`[resend] WARNING: ${fileName} is only ${size} bytes before send.`);
    } catch {
      console.warn(`[resend] WARNING: ${fileName} not found on disk before send.`);
    }

    try {
      await sendReportEmail({
        to: recipients,
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
        attachments: [{ url: downloadUrl, fileName }],
      });
      sent++;
      await logReport({ reportType: 'daily', section: unitName, status: 'sent', fileName, recipients });
      console.log(`[resend] SENT ${unitName} -> ${recipients.length} recipient(s)`);
    } catch (err) {
      failed++;
      await logReport({
        reportType: 'daily',
        section: unitName,
        status: 'failed',
        fileName,
        recipients,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[resend] FAILED ${unitName} — continuing:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[resend] Done. sent=${sent} skipped=${skipped} failed=${failed} total=${reports.length}`);
}

main().catch((err) => {
  console.error('[resend] Fatal:', err);
  process.exitCode = 1;
});
