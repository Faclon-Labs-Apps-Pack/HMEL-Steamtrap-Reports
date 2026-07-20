import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Workbook } from 'exceljs';

/** Node counterpart of the frontend's browser-only `downloadWorkbook.ts` — writes to disk instead of triggering a download. */
export async function saveWorkbook(workbook: Workbook, outputDir: string, filename: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filePath);
  const { size } = await stat(filePath);
  console.log(`[saveWorkbook] Wrote ${filePath} (${size} bytes)`);
  if (size < 5000) {
    console.warn(`[saveWorkbook] WARNING: ${filename} is suspiciously small (${size} bytes) — a real report should be tens of KB. Check the workbook build step.`);
  }
  return filePath;
}
