import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
type Workbook = InstanceType<typeof Workbook>;
import { findDevicesByType, getLastDataPoints } from '../services/iosenseApi';
import { getCorrectiveActions, type CorrectiveActionRecord } from '../services/correctiveActionApi';
import { getTimeSeriesStatsByDevice, type DeviceTimeSeriesStats } from '../services/deviceTimeSeriesStats';
import { getSteamConsumptionTotal } from '../services/steamConsumptionApi';
import { extractDepartmentFromTags } from '../lib/departmentTag';
import { derivePlantCategory, normalizeUnit, CATEGORY_UNIT_ROSTER, UNASSIGNED } from '../lib/plantCategory';
import { classifyStatus } from '../lib/statusClassification';
import {
  getLastWeekRange,
  getMonthToDateRange,
  getFinancialYearToDateRange,
  normalizeDateRange,
  toEpochMs,
  type DateRange,
} from '../lib/dateRange';
import { weeklyReportName, weeklyReportFileName } from '../lib/reportNaming';
import { HMEL_LOGO_WEEKLY_BASE64 } from './hmelLogo';
import {
  buildWeeklyStatusSheet,
  WEEKLY_STATUS_GROUPS,
  type WeeklyKpiWindow,
  type WeeklyPerfWindows,
  type WeeklyUnitStatusRow,
  type WeeklyUnitCARow,
} from './buildWeeklyStatusSheet';
import { applyPrintLayout, formatReportDate } from './printLayout';
import type { Device, LastDataPoint } from '../types/device';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const STEAM_LOSS_SENSOR = 'D11';
const STEAM_SAVING_SENSOR = 'D12';

export interface ManagementReportProgress {
  label: string;
}

export interface WeeklyCategoryReport {
  categoryName: string;
  /** e.g. 'Steam Trap Weekly Report–Refinery-26/07/26' — also the email subject. */
  reportName: string;
  fileName: string;
  workbook: Workbook;
}

const unitOf = (d: Device) => extractDepartmentFromTags(d.tags) ?? UNASSIGNED;

/** Overall Trap Health of a device set over a window: average share of S1 readings classified Normal (a device with no readings counts as 0%). */
function healthPct(devices: Device[], stats: Map<string, DeviceTimeSeriesStats>): number {
  if (devices.length === 0) return 0;
  return devices.reduce((s, d) => s + (stats.get(d.devID)?.statusPercentages.Normal ?? 0), 0) / devices.length;
}

/** Grouped, instantaneous status counts (WEEKLY_STATUS_GROUPS labels) for one unit's devices. */
function groupedStatusCounts(devices: Device[], statusByDevID: Map<string, number | string>): WeeklyUnitStatusRow['counts'] {
  const counts = Object.fromEntries(WEEKLY_STATUS_GROUPS.map((g) => [g.label, 0])) as Record<string, number>;
  for (const d of devices) {
    const status = classifyStatus(statusByDevID.get(d.devID));
    const group = WEEKLY_STATUS_GROUPS.find((g) => g.statuses.includes(status));
    if (group) counts[group.label] += 1;
  }
  return counts;
}

/** Corrective-action records for a device set, counted within a window by `dateAndTime`. */
function countCA(devices: Device[], records: CorrectiveActionRecord[], startMs: number, endMs: number): number {
  const devIDs = new Set(devices.map((d) => d.devID));
  return records.filter((r) => devIDs.has(r.devId) && withinWindow(r.dateAndTime, startMs, endMs)).length;
}

function withinWindow(iso: string, startMs: number, endMs: number): boolean {
  const t = new Date(iso).getTime();
  return t >= startMs && t <= endMs;
}

/**
 * The units to list as rows for a category: the full canonical roster (in order, so units with
 * no devices still appear as blank rows), followed by any live units not in the roster. Live
 * devices are attached to a roster unit by normalized name (so "PE-SWING-LINE-1" fills the
 * "PE Swing Line-1" row).
 */
function categoryUnitRows(categoryName: string, catDevices: Device[]): { displayName: string; devices: Device[] }[] {
  const byNorm = new Map<string, Device[]>();
  for (const d of catDevices) {
    const k = normalizeUnit(unitOf(d));
    const bucket = byNorm.get(k);
    if (bucket) bucket.push(d);
    else byNorm.set(k, [d]);
  }

  const rows: { displayName: string; devices: Device[] }[] = [];
  const used = new Set<string>();
  for (const canonical of CATEGORY_UNIT_ROSTER[categoryName] ?? []) {
    const k = normalizeUnit(canonical);
    rows.push({ displayName: canonical, devices: byNorm.get(k) ?? [] });
    used.add(k);
  }
  for (const [k, devs] of byNorm) {
    if (!used.has(k)) rows.push({ displayName: unitOf(devs[0]), devices: devs });
  }
  return rows;
}

/**
 * Builds the weekly Management Report — ONE WORKBOOK PER PLANT CATEGORY (Refinery / Petchem /
 * …), each a single "Steam Trap Status-<Category>" sheet listing that category's units as rows,
 * matching the client reference ("Steam Trap Weekly Report-Refinery 26-07-2026.xlsx").
 *
 * Windows all end at the reported week's end (range.end): WTD = the reported Mon-Sun week,
 * MTD = that month up to range.end, YTD = the financial year (from Apr 1) up to range.end.
 */
export async function generateManagementReportWorkbooks(
  onProgress?: (progress: ManagementReportProgress) => void,
  opts?: { categories?: string[] },
): Promise<WeeklyCategoryReport[]> {
  const report = (label: string) => onProgress?.({ label });

  report('Loading devices…');
  const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

  const range = normalizeDateRange(getLastWeekRange());
  const generatedAt = new Date();
  const endMs = toEpochMs(range.end);
  const wtdRange = range;
  const mtdRange = getMonthToDateRange(range.end);
  const ytdRange = getFinancialYearToDateRange(range.end);

  report(`Loading current status for ${devices.length} devices…`);
  const lastDPs: LastDataPoint[] = await getLastDataPoints(devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })));
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  report('Loading corrective actions (YTD)…');
  const ytdRecords = await getCorrectiveActions(devices.map((d) => d.devID), { startMs: toEpochMs(ytdRange.start), endMs });

  report('Analyzing S1 history (WTD)…');
  const wtdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(wtdRange.start), endMs);
  report('Analyzing S1 history (MTD)…');
  const mtdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(mtdRange.start), endMs);
  report('Analyzing S1 history (YTD)…');
  const ytdStats = await getTimeSeriesStatsByDevice(devices, toEpochMs(ytdRange.start), endMs);

  // One report per client-defined plant category (Refinery, Petchem) — always both, even if a
  // category has no devices this week. Devices that don't classify into either (untagged in
  // IOsense, or an unknown unit) are surfaced as a warning, not shipped as an "Unassigned" report.
  const categoryNames = Object.keys(CATEGORY_UNIT_ROSTER).filter((c) => !opts?.categories || opts.categories.includes(c));
  const unclassified = devices.filter((d) => !Object.keys(CATEGORY_UNIT_ROSTER).includes(derivePlantCategory(unitOf(d))));
  if (unclassified.length > 0) {
    console.warn(
      `[weekly] ${unclassified.length} device(s) are not in ${categoryNames.join('/')} (missing/unknown department tag) — excluded from all reports. ` +
        `Example devIDs: ${unclassified.slice(0, 5).map((d) => d.devID).join(', ')}`,
    );
  }

  const windowSteam = (devs: Device[], win: DateRange) =>
    Promise.all([
      getSteamConsumptionTotal(devs, STEAM_LOSS_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
      getSteamConsumptionTotal(devs, STEAM_SAVING_SENSOR, toEpochMs(win.start), toEpochMs(win.end)),
    ]);

  const reports: WeeklyCategoryReport[] = [];
  for (const categoryName of categoryNames) {
    const catDevices = devices.filter((d) => derivePlantCategory(unitOf(d)) === categoryName);
    const unitRows = categoryUnitRows(categoryName, catDevices);

    report(`Loading WTD/MTD/YTD steam loss/saving for ${categoryName}…`);
    const [[wLoss, wSave], [mLoss, mSave], [yLoss, ySave]] = await Promise.all([
      windowSteam(catDevices, wtdRange),
      windowSteam(catDevices, mtdRange),
      windowSteam(catDevices, ytdRange),
    ]);
    const kpi = (health: number, lossMT: number, saveMT: number): WeeklyKpiWindow => ({
      trapHealthPct: health,
      steamLossMT: lossMT,
      steamSavingMT: saveMT,
    });
    const perf: WeeklyPerfWindows = {
      wtd: kpi(healthPct(catDevices, wtdStats), wLoss, wSave),
      mtd: kpi(healthPct(catDevices, mtdStats), mLoss, mSave),
      ytd: kpi(healthPct(catDevices, ytdStats), yLoss, ySave),
    };

    const statusRows: WeeklyUnitStatusRow[] = unitRows.map(({ displayName, devices: unitDevices }) => ({
      unitName: displayName,
      counts: groupedStatusCounts(unitDevices, statusByDevID),
      total: unitDevices.length,
    }));

    const caRows: WeeklyUnitCARow[] = unitRows.map(({ displayName, devices: unitDevices }) => ({
      unitName: displayName,
      wtd: countCA(unitDevices, ytdRecords, toEpochMs(wtdRange.start), endMs),
      mtd: countCA(unitDevices, ytdRecords, toEpochMs(mtdRange.start), endMs),
      ytd: countCA(unitDevices, ytdRecords, toEpochMs(ytdRange.start), endMs),
    }));

    const workbook = new Workbook();
    workbook.creator = 'HMEL Steamtrap Reports';
    workbook.created = generatedAt;
    const logoImageId = workbook.addImage({ base64: HMEL_LOGO_WEEKLY_BASE64, extension: 'png' });

    const statusSheet = workbook.addWorksheet(`Steam Trap Status-${categoryName}`.slice(0, 31));
    buildWeeklyStatusSheet(
      statusSheet,
      categoryName,
      range,
      generatedAt,
      perf,
      statusRows,
      caRows,
      logoImageId,
    );
    // Print setup (printing only): A3 landscape, all columns on one page wide. No repeated header
    // row here — the sheet stacks two tables (Status + Corrective Action) with different headers.
    // The printed page title is the report name ("Steam Trap Weekly Report–<Category>").
    applyPrintLayout(statusSheet, {
      reportDate: formatReportDate(range.end),
      title: `Steam Trap Weekly Report–${categoryName.trim()}`,
    });

    reports.push({
      categoryName,
      reportName: weeklyReportName(categoryName, generatedAt),
      fileName: weeklyReportFileName(categoryName, generatedAt),
      workbook,
    });
  }

  return reports;
}
