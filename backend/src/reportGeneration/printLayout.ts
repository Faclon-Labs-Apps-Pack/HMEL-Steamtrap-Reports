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
// Requirement: the company logo must ALWAYS fit within the first TWO header rows and never spill
// into a third — on any platform (Excel for Windows/macOS, Google Sheets, mobile). These reports
// are .xlsx files, so there is no CSS: the web toolkit (max-height / object-fit / clamp() /
// ResizeObserver / media-query breakpoints / browser zoom) does not exist here. This is the
// spreadsheet-native equivalent of that intent:
//   • "max-height: 2 rows"        -> the image HEIGHT is derived from the two header rows' combined
//                                     height and capped by LOGO_ROW_SAFETY, so cross-platform
//                                     row-height/DPI variance can never push it into row 3.
//   • "object-fit: contain"       -> WIDTH is computed from the logo's true aspect ratio (no stretch).
//   • "row tracks, not fixed px"  -> the two rows drive the logo size, not the reverse.
//   • oneCell anchor              -> the image keeps its size/position regardless of later column
//                                     resizing (Excel's closest thing to a fixed, non-reflowing box).
//
// MANUAL TEST CHECKLIST — open a generated report in each and confirm the logo stays within header
// rows 1–2 and never touches row 3 (the .xlsx analogue of the requested 100%/150%/375px/1920px checks):
//   [ ] Excel for Windows            [ ] Excel for macOS
//   [ ] Google Sheets (import .xlsx) [ ] Excel mobile / narrow window
//   [ ] Excel Print Preview (A3 landscape for Weekly, A4 portrait for Daily) — logo not clipped
const PT_TO_PX = 96 / 72; // Excel row heights are in points; embedded images are sized in pixels (96 DPI)
const LOGO_ROW_SAFETY = 0.85; // use ≤85% of the 2-row height as headroom so it can't overflow anywhere

/**
 * Places the logo so it always fits within header rows 1–2 without distortion, and merges the logo
 * cell. `mergeRange` is the logo cell span ('A1:A2' Daily, 'A1:B2' Weekly). Sizes rows 1–2 to
 * `rowHeightPt` and derives the image height from that budget — see the block comment above.
 */
export function addLogoHeader(
  sheet: Worksheet,
  logoImageId: number,
  naturalSize: { width: number; height: number },
  mergeRange: string,
  rowHeightPt = 24,
): void {
  sheet.getRow(1).height = rowHeightPt;
  sheet.getRow(2).height = rowHeightPt;
  sheet.mergeCells(mergeRange);
  const twoRowBudgetPx = 2 * rowHeightPt * PT_TO_PX;
  const height = Math.floor(twoRowBudgetPx * LOGO_ROW_SAFETY); // fits within rows 1–2 with margin
  const width = Math.round(height * (naturalSize.width / naturalSize.height)); // preserve aspect ratio
  sheet.addImage(logoImageId, { tl: { col: 0, row: 0 }, ext: { width, height }, editAs: 'oneCell' });
}

/**
 * Configures PRINTING only (never the on-screen layout or any data) for one sheet, per client spec:
 *  - A3 paper, landscape, fit ALL columns onto one page WIDE (fitToWidth 1), rows flow onto as many
 *    pages tall as needed (fitToHeight 0);
 *  - the given header row repeats at the top of every printed page (printTitlesRow);
 *  - page header = `opts.title` (e.g. "Steam Trap Daily Report–CPP-575") when given, else the Excel
 *    SHEET NAME (`&A`);
 *  - page footer = the report date (left) and "Page X of Y" (`&P of &N`, right), on every page.
 */
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
