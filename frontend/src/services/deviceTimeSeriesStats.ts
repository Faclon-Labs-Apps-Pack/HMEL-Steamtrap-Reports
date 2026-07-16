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

function emptyPercentages(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as Record<StatusColumn, number>;
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
