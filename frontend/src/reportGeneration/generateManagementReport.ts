import { Workbook } from 'exceljs';
import { collectManagementReportData, type ManagementReportProgress } from './collectManagementReportData';
import { buildOverviewSheet } from './buildOverviewSheet';
import { buildDetailSheet } from './buildDetailSheet';
import { buildCorrectiveActionLogSheet } from './buildCorrectiveActionLogSheet';

export type { ManagementReportProgress };

/**
 * Builds the full 5-sheet Management Report workbook, matching
 * "report templates/ManagementReportFormat for Steam Traps 1 (1).xlsx"'s structure with help
 * text stripped and real data populated. Always uses the last fully-completed week (Monday
 * through Sunday) for time-windowed data — status counts in the overview sheets are
 * instantaneous (current status), everything else (percentages, change counts, per-unit
 * corrective action counts, and the Corrective Action Log sheet itself) is windowed to that
 * last week, since this report is generated weekly and should cover a closed period rather
 * than the still-in-progress current week. (The standalone "Corrective Action Log" dashboard
 * tab is intentionally different — that one stays all-time, since it's a running log rather
 * than a period report.)
 */
export async function generateManagementReportWorkbook(
  onProgress?: (progress: ManagementReportProgress) => void,
): Promise<Workbook> {
  const data = await collectManagementReportData(onProgress);

  const workbook = new Workbook();
  workbook.creator = 'HMEL Steamtrap Reports';
  workbook.created = data.generatedAt;

  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-Refiner'),
    'Refinery',
    data.range,
    data.generatedAt,
    data.matrix,
    data.correctiveActionMatrix,
    data.refineryKpis,
  );
  buildOverviewSheet(
    workbook.addWorksheet('SteamtrapStatusOverview-petchem'),
    'Petchem',
    data.range,
    data.generatedAt,
    data.matrix,
    data.correctiveActionMatrix,
    data.petchemKpis,
  );
  buildDetailSheet(workbook.addWorksheet('Refinery'), data.refineryRows);
  buildDetailSheet(workbook.addWorksheet('Petchem'), data.petchemRows);
  buildCorrectiveActionLogSheet(workbook.addWorksheet('Corrective Action Log'), data.logRows);

  return workbook;
}
