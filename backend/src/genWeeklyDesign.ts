import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
import { HMEL_LOGO_WEEKLY_BASE64 } from './reportGeneration/hmelLogo';
import { buildWeeklyStatusSheet, WEEKLY_STATUS_GROUPS } from './reportGeneration/buildWeeklyStatusSheet';
import { applyWeeklyPrintLayout } from './reportGeneration/printLayout';
import { saveWorkbook } from './reportGeneration/saveWorkbook';
import { OUTPUT_DIR } from './config';

// Design-only weekly report: synthetic (zero) data, so we can eyeball the logo header + A4 portrait
// print layout without hitting any API. NOT a real report.
async function main() {
  const workbook = new Workbook();
  const logoImageId = workbook.addImage({ base64: HMEL_LOGO_WEEKLY_BASE64, extension: 'png' });
  const sheet = workbook.addWorksheet('Steam Trap Status-Refinery');

  const zeroWindow = { trapHealthPct: 0, steamLossMT: 0, steamSavingMT: 0 };
  const perf = { wtd: zeroWindow, mtd: zeroWindow, ytd: zeroWindow };
  const emptyCounts = Object.fromEntries(WEEKLY_STATUS_GROUPS.map((g) => [g.label, 0]));
  const units = Array.from({ length: 18 }, (_, i) => `UNIT-${String(i + 1).padStart(2, '0')}`);
  const statusRows = units.map((u) => ({ unitName: u, counts: { ...emptyCounts }, total: 0 }));
  const caRows = units.map((u) => ({ unitName: u, wtd: 0, mtd: 0, ytd: 0 }));

  const range = { start: new Date('2026-08-25T00:00:00+05:30'), end: new Date('2026-08-31T23:59:59+05:30') };
  const generatedAt = new Date('2026-08-31T12:00:00+05:30');

  buildWeeklyStatusSheet(sheet, 'Refinery', range, generatedAt, perf, statusRows, caRows, logoImageId);
  applyWeeklyPrintLayout(sheet);

  const filePath = await saveWorkbook(workbook, OUTPUT_DIR, 'DESIGN-CHECK Weekly Report–Refinery (no data).xlsx');
  console.log(`Saved design-check weekly -> ${filePath}`);
}

main().catch((err) => {
  console.error('Design-check generation failed:', err);
  process.exitCode = 1;
});
