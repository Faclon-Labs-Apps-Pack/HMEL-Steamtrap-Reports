import { OUTPUT_DIR } from './config';
import { generateManagementReportWorkbook } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbook } from './reportGeneration/generateDailyReport';
import { generateMonthlyReportWorkbook } from './reportGeneration/generateMonthlyReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runWeekly(): Promise<void> {
  console.log('[weekly] Generating…');
  const workbook = await generateManagementReportWorkbook((p) => console.log(`[weekly] ${p.label}`));
  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, `Steam-Trap-Weekly-Report_${dateStamp()}.xlsx`);
  console.log(`[weekly] Saved to ${filePath}`);
}

async function runDaily(): Promise<void> {
  console.log('[daily] Generating…');
  const workbook = await generateDailyReportWorkbook((p) => console.log(`[daily] ${p.label}`));
  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, `Steam-Trap-Daily-Report_${dateStamp()}.xlsx`);
  console.log(`[daily] Saved to ${filePath}`);
}

async function runMonthly(): Promise<void> {
  console.log('[monthly] Generating…');
  const workbook = await generateMonthlyReportWorkbook((p) => console.log(`[monthly] ${p.label}`));
  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, `Steam-Trap-Monthly-Report_${dateStamp()}.xlsx`);
  console.log(`[monthly] Saved to ${filePath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const onlyWeekly = args.includes('--weekly');
  const onlyDaily = args.includes('--daily');
  const onlyMonthly = args.includes('--monthly');
  const runAll = !onlyWeekly && !onlyDaily && !onlyMonthly;

  if (runAll || onlyWeekly) await runWeekly();
  if (runAll || onlyDaily) await runDaily();
  if (runAll || onlyMonthly) await runMonthly();
}

main().catch((err) => {
  console.error('Report generation failed:', err);
  process.exitCode = 1;
});
