import { getBulkDeviceTimeSeries } from './iosenseApi';
import { classifyStatus, STATUS_COLUMNS, type StatusColumn } from '../lib/statusClassification';
import { countStatusChanges } from '../lib/countStatusChanges';
import type { Device } from '../types/device';

const STATUS_SENSOR = 'S1';

export interface DeviceTimeSeriesStats {
  statusChangeCount: number;
  /** % of S1 readings in range classified as each status. Approximates % of duration, assuming roughly uniform sampling interval (observed ~30 min in practice). */
  statusPercentages: Record<StatusColumn, number>;
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

/** Derives the percentage-based stats (what the reports consume) from raw counts. */
export function countsToStats(c: DeviceStatCounts): DeviceTimeSeriesStats {
  const percentages = emptyPercentages();
  if (c.totalPoints > 0) {
    for (const col of STATUS_COLUMNS) percentages[col] = (c.counts[col] / c.totalPoints) * 100;
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

    const percentages = emptyPercentages();
    if (points.length > 0) {
      const counts = emptyPercentages();
      for (const point of points) {
        counts[classifyStatus(point.value)] += 1;
      }
      for (const col of STATUS_COLUMNS) {
        percentages[col] = (counts[col] / points.length) * 100;
      }
    }

    result.set(device.devID, { statusChangeCount, statusPercentages: percentages });
  }
  return result;
}
