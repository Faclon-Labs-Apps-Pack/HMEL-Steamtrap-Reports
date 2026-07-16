import type { Fill, Border, Alignment } from 'exceljs';

export const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

export const THIN_BORDER: Partial<Border> = { style: 'thin', color: { argb: 'FF000000' } };
export const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

export const CENTER: Partial<Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
export const LEFT: Partial<Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };

export const HEADER_FONT = { bold: true };
export const BOLD_FONT = { bold: true };
