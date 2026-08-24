import { OUTPUT_DIR } from './config';
import { generateManagementReportWorkbooks } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbooks } from './reportGeneration/generateDailyReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';

async function runWeekly(): Promise<void> {
  console.log('[weekly] Generating…');
  const reports = await generateManagementReportWorkbooks((p) => console.log(`[weekly] ${p.label}`));
  for (const { categoryName, fileName, workbook } of reports) {
    const filePath = await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    console.log(`[weekly] Saved ${categoryName} report to ${filePath}`);
  }
}

async function runDaily(): Promise<void> {
  console.log('[daily] Generating…');
  const reports = await generateDailyReportWorkbooks((p) => console.log(`[daily] ${p.label}`));
  for (const { unitName, fileName, workbook } of reports) {
    const filePath = await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    console.log(`[daily] Saved ${unitName} report to ${filePath}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlyWeekly = args.includes('--weekly');
  const onlyDaily = args.includes('--daily');
  const runAll = !onlyWeekly && !onlyDaily;

  if (runAll || onlyWeekly) await runWeekly();
  if (runAll || onlyDaily) await runDaily();
}

main().catch((err) => {
  console.error('Report generation failed:', err);
  process.exitCode = 1;
});
