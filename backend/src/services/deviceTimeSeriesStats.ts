import { getBulkDeviceTimeSeries } from './iosenseApi';
import { classifyStatus, analysisStatusGroup, STATUS_COLUMNS, FLOODING_STATUSES, isFloodingStatus, type StatusColumn } from '../lib/statusClassification';
import { countStatusChanges, countChangesIntoStatus } from '../lib/countStatusChanges';
import type { Device } from '../types/device';

const STATUS_SENSOR = 'S1';

export interface DeviceTimeSeriesStats {
  statusChangeCount: number;
  /** % of S1 readings in range classified as each status. Approximates % of duration, assuming roughly uniform sampling interval (observed ~30 min in practice). */
  statusPercentages: Record<StatusColumn, number>;
  /**
   * How many times the device changed INTO each (grouped) status over the window — the per-status
   * breakdown of `statusChangeCount`, keyed by the grouped label (Normal / Leak / Choking / Valve
   * Closed / No Status / Offline). Only the on-demand Analysis report renders these; the scheduled
   * reports ignore the field. NOT cached per-day (transition counts don't sum across day
   * boundaries), so it is only populated on the live range sweep below.
   */
  changesIntoStatus?: Record<string, number>;
}

/**
 * The RAW, additive form of a device's S1 stats for a window — reading COUNTS per status plus the
 * total, not percentages. This is what the daily-stats cache stores per day: counts sum cleanly
 * across days (percentages do not), so WTD/MTD/YTD can be rebuilt by summing daily buckets instead
 * of re-sweeping the whole range from IOsense. See services/dailyStatsStore.ts.
 */
export interface DeviceStatCounts {
  statusChangeCount: number;
  counts: Record<StatusColumn, number>;
  totalPoints: number;
}

function emptyPercentages(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
}

function emptyCounts(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
}

/**
 * Derives the percentage-based stats (what the reports consume) from raw counts. Flooding readings
 * are DROPPED ENTIRELY (see FLOODING_STATUSES): excluded from the denominator and left at 0%, so the
 * remaining statuses are shares of the non-flooding readings and sum to 100% among themselves.
 */
export function countsToStats(c: DeviceStatCounts): DeviceTimeSeriesStats {
  const percentages = emptyPercentages();
  const floodingPoints = FLOODING_STATUSES.reduce((s, col) => s + (c.counts[col] ?? 0), 0);
  const base = c.totalPoints - floodingPoints; // non-flooding readings only
  if (base > 0) {
    for (const col of STATUS_COLUMNS) {
      if (isFloodingStatus(col)) continue; // dropped
      percentages[col] = (c.counts[col] / base) * 100;
    }
  }
  return { statusChangeCount: c.statusChangeCount, statusPercentages: percentages };
}

/**
 * Like {@link getTimeSeriesStatsByDevice} but returns the RAW counts (for the daily-stats cache).
 * One bulk S1 fetch for the window; callers use this for a single DAY (light, reliable) and persist
 * the result, then sum days to form longer windows.
 */
export async function getStatCountsByDevice(
  devices: Device[],
  startMs: number,
  endMs: number,
): Promise<Map<string, DeviceStatCounts>> {
  const seriesByDevID = await getBulkDeviceTimeSeries(
    devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })),
    startMs,
    endMs,
  );
  const result = new Map<string, DeviceStatCounts>();
  for (const device of devices) {
    const points = seriesByDevID.get(device.devID) ?? [];
    const counts = emptyCounts();
    for (const point of points) counts[classifyStatus(point.value)] += 1;
    result.set(device.devID, {
      statusChangeCount: countStatusChanges(points),
      counts,
      totalPoints: points.length,
    });
  }
  return result;
}

/**
 * Fetches S1 history for ALL devices in one bulk request (see `getBulkDeviceTimeSeries`) and
 * derives both the status-change count and per-status percentage breakdown per device from it —
 * one HTTP call total instead of one per device per metric.
 */
export async function getTimeSeriesStatsByDevice(
  devices: Device[],
  startMs: number,
  endMs: number,
): Promise<Map<string, DeviceTimeSeriesStats>> {
  const seriesByDevID = await getBulkDeviceTimeSeries(
    devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })),
    startMs,
    endMs,
  );

  const result = new Map<string, DeviceTimeSeriesStats>();
  for (const device of devices) {
    const points = seriesByDevID.get(device.devID) ?? [];
    const statusChangeCount = countStatusChanges(points);
    // Per-status "changed into X" counts, grouped the same way as the status/duration columns
    // (Mild/Heavy Leak -> "Leak"). Classified labels, so a 1->3 reading (both Normal) isn't a change.
    const changesIntoStatus = countChangesIntoStatus(points, (value) => analysisStatusGroup(classifyStatus(value)));

    // Flooding readings are DROPPED ENTIRELY: excluded from the denominator and left at 0%, so the
    // remaining statuses are shares of the non-flooding readings (see FLOODING_STATUSES).
    const percentages = emptyPercentages();
    if (points.length > 0) {
      const counts = emptyPercentages();
      for (const point of points) {
        counts[classifyStatus(point.value)] += 1;
      }
      const floodingPoints = FLOODING_STATUSES.reduce((s, col) => s + counts[col], 0);
      const base = points.length - floodingPoints;
      if (base > 0) {
        for (const col of STATUS_COLUMNS) {
          if (isFloodingStatus(col)) continue; // dropped
          percentages[col] = (counts[col] / base) * 100;
        }
      }
    }

    result.set(device.devID, { statusChangeCount, statusPercentages: percentages, changesIntoStatus });
  }
  return result;
}
