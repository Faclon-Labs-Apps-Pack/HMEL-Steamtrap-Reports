import { Workbook } from 'exceljs';
import { collectManagementReportData } from './collectManagementReportData';
import { buildOverviewSheet } from './buildOverviewSheet';
import { buildDetailSheet } from './buildDetailSheet';
import { buildCorrectiveActionLogSheet } from './buildCorrectiveActionLogSheet';
import { getLastMonthRange, normalizeDateRange } from '../lib/dateRange';

export interface MonthlyReportProgress {
  label: string;
}

/**
 * Builds the Monthly Management Report workbook — EXACT same 5-sheet template as
 * `generateManagementReport.ts` (same sheet names, same columns, same data source via
 * `collectManagementReportData`), the only difference being the time window: last
 * fully-completed calendar month (via `getLastMonthRange`) instead of last fully-completed week.
 */
export async function generateMonthlyReportWorkbook(
  onProgress?: (progress: MonthlyReportProgress) => void,
): Promise<Workbook> {
  const data = await collectManagementReportData(onProgress, normalizeDateRange(getLastMonthRange()));

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
