import type { Worksheet, PaperSize } from 'exceljs';

// ExcelJS's PaperSize enum omits A3, but 8 is the correct OOXML paper-size code and is written verbatim.
const A3_PAPER_SIZE = 8 as PaperSize;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The report's own date as DD-MMM-YY (e.g. 27-Aug-26) — a fixed value, NOT the print-time date. */
export function formatReportDate(d: Date): string {
  return `${pad2(d.getDate())}-${MONTH_ABBR[d.getMonth()]}-${pad2(d.getFullYear() % 100)}`;
}

// --- Logo header (shared by the Daily Summary + Weekly Status sheets) ----------------------------
// Requirement: the company logo must ALWAYS be fully enclosed within the merged header cell in rows
// 1-2 and can NEVER cross the Row 2 / Row 3 boundary - in Microsoft 365 Excel desktop (incl. Excel
// 2608), Excel Web, and across screen sizes / zoom levels / DPI. These are .xlsx files, so there is
// no CSS. The robust spreadsheet-native way to guarantee that is a TWO-CELL anchor pinned to whole
// CELL BOUNDARIES:
//   - The bottom-right corner is the actual Row 2 / Row 3 boundary (row index 2) and the end of the
//     merged logo columns. Because both corners are real cell boundaries (not a fixed pixel size),
//     Excel derives the image's on-screen size FROM the cells every time it draws. The bottom edge
//     IS the Row 2 / Row 3 line, so it is impossible for the logo to reach Row 3 - at any zoom, DPI,
//     window size or Excel build, and even if a row height is later auto-fit/changed (which is what
//     makes a fixed-pixel oneCell image spill over - exactly requirements #6/#7: no fixed pixel
//     positioning). 'twoCell' = the image moves AND sizes with the cells.
//   - Row 1 & 2 heights are sized (in POINTS, which are absolute) so the two-row block matches the
//     logo's aspect ratio; filling the merge then keeps the logo undistorted (never cropped or
//     stretched). Column widths are read as-is and never changed.
//
// MANUAL TEST CHECKLIST - open a generated report and confirm the logo stays within header rows 1-2
// and never touches Row 3:
//   [ ] Microsoft 365 Excel desktop (Windows, incl. v2608)   [ ] Excel for macOS
//   [ ] Excel Web / online          [ ] different window sizes / zoom levels / DPI scaling
//   [ ] Print Preview (A4 portrait for Weekly and Daily) - logo not clipped
const PT_PER_PX = 72 / 96; // Excel row heights are in points; column-width pixels are 96 DPI
const EXCEL_MDW_PX = 7; // max-digit width for the workbook's default font (Calibri 11) - width->px unit
const EXCEL_COL_PADDING_PX = 5; // per-column gridline/padding pixels in the width->pixel formula

/** Excel column letters -> 1-based index (A->1, B->2, ..., AA->27). */
function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Excel's column "width" (character units) -> rendered pixels for the workbook's default font. */
function columnWidthToPx(widthChars: number): number {
  return Math.round(widthChars * EXCEL_MDW_PX) + EXCEL_COL_PADDING_PX;
}

/**
 * Places the company logo so it is ALWAYS fully enclosed within the merged header cell (rows 1-2)
 * and can never cross into row 3 - see the block comment above. `mergeRange` is the logo cell span
 * ('A1:A2' Daily, 'A1:B2' Weekly). The logo keeps its aspect ratio (never cropped/stretched) and is
 * anchored to whole cell boundaries (not a fixed screen/pixel position), so it holds across Excel
 * desktop/Web, zoom, DPI and window size. Column widths are read as-is (never changed); only rows
 * 1 & 2 grow.
 */
export function addLogoHeader(
  sheet: Worksheet,
  logoImageId: number,
  naturalSize: { width: number; height: number },
  mergeRange: string,
): void {
  const m = mergeRange.match(/^([A-Z]+)\d+:([A-Z]+)\d+$/);
  if (!m) throw new Error(`addLogoHeader: unsupported mergeRange "${mergeRange}"`);
  const startCol = columnLettersToIndex(m[1]); // 1-based
  const endCol = columnLettersToIndex(m[2]); // 1-based, inclusive

  // Total pixel width of the merged logo columns (read from the existing column widths - unchanged).
  let mergedWidthPx = 0;
  for (let c = startCol; c <= endCol; c++) mergedWidthPx += columnWidthToPx(sheet.getColumn(c).width ?? 8.43);

  // Size rows 1 & 2 (in points - absolute) so the two-row block matches the logo's aspect ratio:
  // block height = width / aspect. Filling the merge then preserves the aspect ratio exactly.
  const aspect = naturalSize.width / naturalSize.height;
  const twoRowHeightPx = mergedWidthPx / aspect;
  const rowHeightPt = (twoRowHeightPx * PT_PER_PX) / 2;
  sheet.getRow(1).height = rowHeightPt;
  sheet.getRow(2).height = rowHeightPt;
  sheet.mergeCells(mergeRange);

  // TWO-CELL anchor on whole CELL BOUNDARIES: top-left of the merge -> (end of merged columns, Row 2
  // /Row 3 boundary at row index 2). Excel sizes the image from these cells, so the bottom edge is
  // the Row 2/Row 3 line and can never cross into Row 3. ExcelJS scales only integer (whole-cell)
  // anchors from the real column/row sizes, so both corners are integers here.
  sheet.addImage(logoImageId, {
    tl: { col: startCol - 1, row: 0 },
    br: { col: endCol, row: 2 },
    editAs: 'twoCell',
  } as unknown as Parameters<Worksheet['addImage']>[1]);
}

/**
 * Print setup for the DAILY Summary sheet ONLY — a deliberately different layout from Analysis/Live
 * Status: A4 portrait, the WHOLE sheet scaled to fit on exactly one page (fitToWidth 1 + fitToHeight
 * 1), and NO print header or footer at all (no title, no sheet name, no date, no page number).
 */
export function applySummaryPrintLayout(sheet: Worksheet): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: 9, // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1, // whole Summary on exactly one page — no extra pages across or down
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
  };
  // Nothing in the print header/footer for the Summary.
  sheet.headerFooter = {
    oddHeader: '',
    evenHeader: '',
    oddFooter: '',
    evenFooter: '',
    firstHeader: '',
    firstFooter: '',
  };
}

/**
 * Print setup for the WEEKLY status sheet ONLY: A4 portrait (the default print paper/orientation)
 * with the ENTIRE report scaled onto exactly one page — all columns on one page across (fitToWidth
 * 1, no column spills to a second horizontal page) and all rows on one page down (fitToHeight 1) —
 * and NO print header, footer or page number of any kind. Nothing is added to the printout beyond
 * the report content itself.
 */
export function applyWeeklyPrintLayout(sheet: Worksheet): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: 9, // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1, // all columns on ONE page across — nothing moves to a second horizontal page
    fitToHeight: 1, // whole report on ONE page down as well
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
  };
  // No print header/footer/page-number at all.
  sheet.headerFooter = {
    oddHeader: '',
    evenHeader: '',
    oddFooter: '',
    evenFooter: '',
    firstHeader: '',
    firstFooter: '',
  };
}

export function applyPrintLayout(
  sheet: Worksheet,
  opts: { reportDate: string; repeatHeaderRow?: number; title?: string },
): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: A3_PAPER_SIZE, // A3
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1, // all columns on ONE page across
    fitToHeight: 0, // unlimited pages down
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    ...(opts.repeatHeaderRow ? { printTitlesRow: `${opts.repeatHeaderRow}:${opts.repeatHeaderRow}` } : {}),
  };

  // Centered, bold, size 14. A literal title (report name) when given, else &A = the sheet name.
  // Literal ampersands must be doubled so Excel doesn't read them as format codes.
  const titleField = opts.title ? opts.title.replace(/&/g, '&&') : '&A';
  const header = `&C&"Calibri,Bold"&14${titleField}`;
  // No font-size code before the date: "&10" immediately followed by the day digit ("&1027-…")
  // is misparsed by Excel as font size 1027 and eats the day. Default footer font is fine.
  const footer = `&L${opts.reportDate}&RPage &P of &N`;
  sheet.headerFooter = {
    oddHeader: header,
    evenHeader: header,
    oddFooter: footer,
    evenFooter: footer,
  };
}
