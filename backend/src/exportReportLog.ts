import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LOG_DIR, REPORT_TIMEZONE } from './config';
import { BLUE_HEADER_FILL, ALL_BORDERS, HEADER_FONT, fitColumnWidths } from './reportGeneration/xlsxStyles';
import type { ReportLogEntry, ReportLogStatus } from './scheduler/reportLog';

const JSONL = path.join(LOG_DIR, 'report-log.jsonl');
const XLSX = path.join(LOG_DIR, 'report-log.xlsx');

interface LoggedRow extends ReportLogEntry {
  time: string; // ISO
}

/** ISO instant -> "24-Aug-26 15:15:03 IST" in the report timezone. */
function formatIST(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second} IST`;
}

// Row tint by outcome: sent = green, failed/generation-failed = red, skipped = amber.
const STATUS_FILL: Record<ReportLogStatus, string> = {
  sent: 'FFE2EFDA',
  failed: 'FFF8CBAD',
  'generation-failed': 'FFF8CBAD',
  skipped: 'FFFFF2CC',
};

const HEADERS = ['Sr No', 'Date & Time (IST)', 'Status', 'Report', 'Section', 'File Name', 'Recipients', 'Reason'];

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(JSONL, 'utf-8');
  } catch {
    console.log(`No log yet at ${JSONL} — nothing to export (reports send-log builds up as scheduled reports run).`);
    return;
  }

  const rows: LoggedRow[] = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LoggedRow);

  const values = rows.map((r, i) => [
    i + 1,
    formatIST(r.time),
    r.status.toUpperCase(),
    r.reportType,
    r.section,
    r.fileName ?? '',
    (r.recipients ?? []).join(', '),
    r.error ?? '',
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HMEL Steamtrap Reports';
  const sheet = wb.addWorksheet('Report Send Log');
  sheet.columns = fitColumnWidths(HEADERS, values, { min: 8, max: 40, maxByCol: { 5: 48, 6: 40, 7: 60 } });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const header = sheet.getRow(1);
  header.values = HEADERS;
  header.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = BLUE_HEADER_FILL;
    cell.border = ALL_BORDERS;
  });

  values.forEach((v, i) => {
    const excelRow = sheet.getRow(i + 2);
    excelRow.values = v;
    const fill = STATUS_FILL[rows[i].status];
    excelRow.eachCell((cell) => {
      cell.border = ALL_BORDERS;
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  });

  await wb.xlsx.writeFile(XLSX);

  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  console.log(`Exported ${rows.length} log entr${rows.length === 1 ? 'y' : 'ies'} to ${XLSX}`);
  console.log(`  ${Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join('  |  ')}`);
}

main().catch((err) => {
  console.error('Report-log export failed:', err);
  process.exitCode = 1;
});
