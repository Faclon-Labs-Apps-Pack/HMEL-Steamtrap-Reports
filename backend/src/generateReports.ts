import { OUTPUT_DIR } from './config';
import { generateManagementReportWorkbook } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbook } from './reportGeneration/generateDailyReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runManagement(): Promise<void> {
  console.log('[management] Generating…');
  const workbook = await generateManagementReportWorkbook((p) => console.log(`[management] ${p.label}`));
  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, `Steam-Trap-Management-Report_${dateStamp()}.xlsx`);
  console.log(`[management] Saved to ${filePath}`);
}

async function runDaily(): Promise<void> {
  console.log('[daily] Generating…');
  const workbook = await generateDailyReportWorkbook((p) => console.log(`[daily] ${p.label}`));
  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, `Steam-Trap-Daily-Report_${dateStamp()}.xlsx`);
  console.log(`[daily] Saved to ${filePath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const onlyManagement = args.includes('--management');
  const onlyDaily = args.includes('--daily');
  const runBoth = !onlyManagement && !onlyDaily;

  if (runBoth || onlyManagement) await runManagement();
  if (runBoth || onlyDaily) await runDaily();
}

main().catch((err) => {
  console.error('Report generation failed:', err);
  process.exitCode = 1;
});
