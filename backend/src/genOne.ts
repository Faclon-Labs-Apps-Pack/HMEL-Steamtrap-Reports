import './setTimezone'; // render dates in IST, like the real scheduler
import { OUTPUT_DIR } from './config';
import { generateManagementReportWorkbooks } from './reportGeneration/generateManagementReport';
import { generateDailyReportWorkbooks } from './reportGeneration/generateDailyReport';
import { saveWorkbook } from './reportGeneration/saveWorkbook';

// Test-only: generate ONE daily unit (SRU) + ONE weekly category (Refinery) to verify design changes.
async function main() {
  console.log('[test] Daily (SRU only)…');
  const daily = await generateDailyReportWorkbooks((p) => console.log(`[daily] ${p.label}`), {
    unitKeys: ['SRU'],
    fast: true,
  });
  for (const { unitName, fileName, workbook } of daily) {
    console.log(`[daily] Saved ${unitName} -> ${await saveWorkbook(workbook, OUTPUT_DIR, fileName)}`);
  }

  console.log('[test] Weekly (Refinery only)…');
  const weekly = await generateManagementReportWorkbooks((p) => console.log(`[weekly] ${p.label}`), {
    categories: ['Refinery'],
  });
  for (const { categoryName, fileName, workbook } of weekly) {
    console.log(`[weekly] Saved ${categoryName} -> ${await saveWorkbook(workbook, OUTPUT_DIR, fileName)}`);
  }
}

main().catch((err) => {
  console.error('Test generation failed:', err);
  process.exitCode = 1;
});
