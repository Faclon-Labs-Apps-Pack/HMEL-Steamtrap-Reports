import type { Worksheet, PaperSize } from 'exceljs';

// ExcelJS's PaperSize enum omits A3, but 8 is the correct OOXML paper-size code and is written verbatim.
const A3_PAPER_SIZE = 8 as PaperSize;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The report's own date as DD-MMM-YY (e.g. 27-Aug-26) — a fixed value, NOT the print-time date. */
export function formatReportDate(d: Date): string {
  return `${pad2(d.getDate())}-${MONTH_ABBR[d.getMonth()]}-${pad2(d.getFullYear() % 100)}`;
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
