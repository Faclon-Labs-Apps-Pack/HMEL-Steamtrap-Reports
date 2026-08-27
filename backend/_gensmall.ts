import { generateDailyReportWorkbooks } from './src/reportGeneration/generateDailyReport';
import { saveWorkbook } from './src/reportGeneration/saveWorkbook';
import { OUTPUT_DIR } from './src/config';
const t = () => new Date().toISOString().slice(11,19);
async function main() {
  const reports = await generateDailyReportWorkbooks(
    (p) => console.log(t(), p.label),
    { unitKeys: ['SRU', 'MSB', 'VGO', 'HGU', 'PETCHEM_PPU', 'HDPE'], fast: true },
  );
  for (const { unitName, fileName, workbook } of reports) {
    const path = await saveWorkbook(workbook, OUTPUT_DIR, fileName);
    console.log(t(), 'SAVED', fileName);
  }
  console.log(t(), 'ALLDONE');
}
main().catch((e) => { console.error(t(), 'ERR', String(e).slice(0,300)); process.exit(1); });
