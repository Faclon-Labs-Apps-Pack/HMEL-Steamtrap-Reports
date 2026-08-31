import type { Fill, Border, Alignment } from 'exceljs';

export const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

// Daily Report headers are blue (client template "steamTrap-DailyReport (1).xlsx" used #DCE6F1;
// client then asked for a little darker shade of the same blue), not the yellow the Management
// Report keeps.
export const BLUE_HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };

/** Daily Report Analysis rows whose status isn't Normal are flagged in red font, per client spec. */
export const RED_FONT = { color: { argb: 'FFFF0000' } };

export const THIN_BORDER: Partial<Border> = { style: 'thin', color: { argb: 'FF000000' } };
// Table borders use MEDIUM weight, not thin: Excel drops hairline/thin borders in print and print-
// preview when the sheet is scaled to fit a page (or when "Draft quality" is on), which makes the
// grid look like it disappears on paper even though it shows on screen (where gridlines mask it).
// Medium lines survive that scaling, so the printed grid matches the on-screen design.
export const MEDIUM_BORDER: Partial<Border> = { style: 'medium', color: { argb: 'FF000000' } };
export const ALL_BORDERS = { top: MEDIUM_BORDER, left: MEDIUM_BORDER, bottom: MEDIUM_BORDER, right: MEDIUM_BORDER };

export const CENTER: Partial<Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
export const LEFT: Partial<Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };

export const HEADER_FONT = { bold: true };
export const BOLD_FONT = { bold: true };

/**
 * Column widths sized to the actual content, not just the header text — so values longer than
 * their header (e.g. a "Refinery-Offsite" department under a "Department" header, or a long
 * Location description) aren't clipped. For each column, width = longest cell (header + every
 * data row) + a small padding, clamped to [min, max]. `rows` are the value arrays exactly as
 * written to the sheet; `maxByCol` optionally raises the cap for specific columns (e.g. Location).
 */
export function fitColumnWidths(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  opts: { min?: number; max?: number; maxByCol?: Record<number, number>; dataDriven?: boolean } = {},
): { width: number }[] {
  const { min = 10, max = 32, maxByCol = {}, dataDriven = false } = opts;
  const len = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : String(v).length);
  const longestWord = (s: string) => Math.max(0, ...String(s).split(/\s+/).map((w) => w.length));
  return headers.map((h, col) => {
    const dataLongest = Math.max(0, ...rows.map((r) => len(r[col])));
    const cap = maxByCol[col] ?? max;
    // dataDriven: size from the DATA, not the heading (headings wrap between words) — but never
    // narrower than the heading's longest single word, which cannot wrap. Otherwise: widest of the two.
    const target = dataDriven
      ? Math.max(dataLongest + 2, longestWord(h) + 1)
      : Math.max(len(h), dataLongest) + 2;
    return { width: Math.min(cap, Math.max(min, target)) };
  });
}

/**
 * Estimated height (points) for a wrapped header row: greedily word-wraps each heading to its
 * column width, and returns the tallest column's line count × lineHeight — so multi-line headings
 * aren't clipped in viewers that don't auto-fit.
 */
export function estimateHeaderHeight(
  headers: string[],
  columns: { width: number }[],
  lineHeight = 15,
): number {
  const linesFor = (text: string, width: number) => {
    let lines = 1;
    let cur = 0;
    for (const w of String(text).split(/\s+/)) {
      if (cur === 0) cur = w.length;
      else if (cur + 1 + w.length <= width) cur += 1 + w.length;
      else {
        lines++;
        cur = w.length;
      }
    }
    return lines;
  };
  const maxLines = Math.max(1, ...headers.map((h, i) => linesFor(h, columns[i]?.width ?? 10)));
  return maxLines * lineHeight;
}
