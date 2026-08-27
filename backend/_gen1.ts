import { generateDailyReportWorkbooks } from './src/reportGeneration/generateDailyReport';
import { saveWorkbook } from './src/reportGeneration/saveWorkbook';
import { OUTPUT_DIR } from './src/config';
async function main() {
  const reports = await generateDailyReportWorkbooks((p) => console.log(new Date().toISOString().slice(11,19), p.label), { unitKeys: ['CPP_575'] });
  for (const { unitName, fileName, workbook } of reports) {
    const path = await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    console.log(`SAVED ${unitName} -> ${path}`);
  }
  console.log('ALLDONE');
}
main().catch((e) => { console.error('GENERR', String(e).slice(0, 400)); process.exit(1); });
