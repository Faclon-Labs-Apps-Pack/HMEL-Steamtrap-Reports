import type { Fill, Border, Alignment } from 'exceljs';

export const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

// Daily Report headers are blue (client template "steamTrap-DailyReport (1).xlsx" used #DCE6F1;
// client then asked for a little darker shade of the same blue), not the yellow the Management
// Report keeps.
export const BLUE_HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };

/** Daily Report Analysis rows whose status isn't Normal are flagged in red font, per client spec. */
export const RED_FONT = { color: { argb: 'FFFF0000' } };

export const THIN_BORDER: Partial<Border> = { style: 'thin', color: { argb: 'FF000000' } };
export const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

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
  opts: { min?: number; max?: number; maxByCol?: Record<number, number> } = {},
): { width: number }[] {
  const { min = 10, max = 32, maxByCol = {} } = opts;
  const len = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : String(v).length);
  return headers.map((h, col) => {
    const longest = Math.max(len(h), ...rows.map((r) => len(r[col])));
    const cap = maxByCol[col] ?? max;
    return { width: Math.min(cap, Math.max(min, longest + 2)) };
  });
}
