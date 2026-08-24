const pad2 = (n: number) => String(n).padStart(2, '0');

/** dd/mm/yy of the report generation time — the client-specified date stamp for report names. */
function reportStamp(generatedAt: Date): string {
  return `${pad2(generatedAt.getDate())}/${pad2(generatedAt.getMonth() + 1)}/${pad2(generatedAt.getFullYear() % 100)}`;
}

/** Replaces characters that are illegal in file names with '-' — unavoidably including the '/' of the dd/mm/yy stamp (no OS allows '/' in a file name). */
function toFileName(reportName: string): string {
  return `${reportName.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`;
}

/**
 * Client-specified Daily Report name — one report per unit, named after the unit plus the
 * report GENERATION date in dd/mm/yy, e.g. 'Steam Trap Daily Report–Petchem Offsite-28/07/26'.
 * This exact string goes in the Summary sheet's "Report Name" row and the email subject.
 */
export function dailyReportName(unitName: string, generatedAt: Date): string {
  return `Steam Trap Daily Report–${unitName.trim()}-${reportStamp(generatedAt)}`;
}

/** dailyReportName + '.xlsx' with illegal characters replaced. Anywhere this lands in a URL it must go through encodeURIComponent. */
export function dailyReportFileName(unitName: string, generatedAt: Date): string {
  return toFileName(dailyReportName(unitName, generatedAt));
}

/**
 * Client-specified Weekly Management Report name — one report per plant category (Refinery /
 * Petchem), e.g. 'Steam Trap Weekly Report–Refinery-28/07/26'. Per the template's own note
 * ("File Name & Email Subject Name to be as per Report Name"), this exact string is also the
 * sheet's "Report Name" row and the email subject.
 */
export function weeklyReportName(unitName: string, generatedAt: Date): string {
  return `Steam Trap Weekly Report–${unitName.trim()}-${reportStamp(generatedAt)}`;
}

/** weeklyReportName + '.xlsx' with illegal characters replaced. Anywhere this lands in a URL it must go through encodeURIComponent. */
export function weeklyReportFileName(unitName: string, generatedAt: Date): string {
  return toFileName(weeklyReportName(unitName, generatedAt));
}
