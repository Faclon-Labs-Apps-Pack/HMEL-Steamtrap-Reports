import { Workbook } from 'exceljs';
import { collectDailyReportData, type DailyReportProgress } from './collectDailyReportData';
import { buildDailySummarySheet } from './buildDailySummarySheet';
import { buildDailyAnalysisSheet } from './buildDailyAnalysisSheet';
import { buildDailyLiveStatusSheet } from './buildDailyLiveStatusSheet';

export type { DailyReportProgress };

/**
 * Builds the 3-sheet Daily Report workbook (Summary, Analysis, Live Status), matching
 * "report templates/steamTrap-DailyReport 2.xlsx"'s structure with help text stripped and real
 * data populated. Unlike the Management Report, this has NO plant-category segregation — one
 * flat list of all steam trap devices, per explicit spec. Windowed to TODAY (not current week)
 * since this is a daily report, matching its name and the source template's own 24hr duration.
 */
export async function generateDailyReportWorkbook(
  onProgress?: (progress: DailyReportProgress) => void,
): Promise<Workbook> {
  const data = await collectDailyReportData(onProgress);

  const workbook = new Workbook();
  workbook.creator = 'HMEL Steamtrap Reports';
  workbook.created = data.generatedAt;

  buildDailySummarySheet(
    workbook.addWorksheet('Summary'),
    data.devices,
    data.statusCounts,
    data.range,
    data.generatedAt,
    data.correctiveActionTotal,
    data.feedbackTotal,
    data.statusChangeTotal,
    data.steamLossTotal,
    data.steamSavingTotal,
  );
  buildDailyAnalysisSheet(workbook.addWorksheet('Analysis'), data.analysisRows);
  buildDailyLiveStatusSheet(workbook.addWorksheet('Live Status'), data.liveStatusRows);

  return workbook;
}
