import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Workbook } from 'exceljs';

/** Node counterpart of the frontend's browser-only `downloadWorkbook.ts` — writes to disk instead of triggering a download. */
export async function saveWorkbook(workbook: Workbook, outputDir: string, filename: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filePath);
  console.log(`[saveWorkbook] Wrote ${filePath}`);
  return filePath;
}
