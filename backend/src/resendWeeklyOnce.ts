import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { OUTPUT_DIR, getWeeklyRecipientsForCategory, getReportBaseUrl } from './config';
import { generateManagementReportWorkbooks } from './reportGeneration/generateManagementReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { sendReportEmail } from './email/sendReportEmail';
import { logReport } from './scheduler/reportLog';

/**
 * One-off manual resend of the weekly management reports (Refinery + Petchem), used to recover a
 * week whose scheduled Monday 08:30 run failed (e.g. 2026-09-28, aborted by an expired IOsense
 * token). Mirrors the scheduler's generateWeekly + sendPendingList flow: generate each category,
 * save to OUTPUT_DIR (served by the running pm2 fileServer), then email each to its recipients.
 */
const WEEKLY_CATEGORIES = ['Refinery', 'Petchem'];

async function main(): Promise<void> {
  console.log('[resend-weekly] Generating weekly reports…');
  const reports = await generateManagementReportWorkbooks((p) => console.log(`[resend-weekly] ${p.label}`), {
    categories: WEEKLY_CATEGORIES,
  });

  console.log(`[resend-weekly] Generated ${reports.length} category reports. Sending…`);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const { categoryName, reportName, fileName, workbook } of reports) {
    await saveWorkbook(workbook, OUTPUT_DIR, fileName);

    const recipients = getWeeklyRecipientsForCategory(categoryName);
    if (recipients.length === 0) {
      skipped++;
      await logReport({ reportType: 'weekly', section: categoryName, status: 'skipped', fileName, error: 'No recipients configured' });
      console.warn(`[resend-weekly] SKIP ${categoryName} — no recipients`);
      continue;
    }

    const downloadUrl = `${getReportBaseUrl()}/report/${encodeURIComponent(fileName)}`;
    try {
      const { size } = await stat(path.join(OUTPUT_DIR, fileName));
      if (size < 5000) console.warn(`[resend-weekly] WARNING: ${fileName} is only ${size} bytes before send.`);
    } catch {
      console.warn(`[resend-weekly] WARNING: ${fileName} not found on disk before send.`);
    }

    try {
      await sendReportEmail({
        to: recipients,
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
        attachments: [{ url: downloadUrl, fileName }],
      });
      sent++;
      await logReport({ reportType: 'weekly', section: categoryName, status: 'sent', fileName, recipients });
      console.log(`[resend-weekly] SENT ${categoryName} -> ${recipients.length} recipient(s)`);
    } catch (err) {
      failed++;
      await logReport({
        reportType: 'weekly',
        section: categoryName,
        status: 'failed',
        fileName,
        recipients,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[resend-weekly] FAILED ${categoryName} — continuing:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[resend-weekly] Done. sent=${sent} skipped=${skipped} failed=${failed} total=${reports.length}`);
}

main().catch((err) => {
  console.error('[resend-weekly] Fatal:', err);
  process.exitCode = 1;
});
