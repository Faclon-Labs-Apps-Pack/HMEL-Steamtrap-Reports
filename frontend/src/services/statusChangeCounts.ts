import { getBulkDeviceTimeSeries } from './iosenseApi';
import { countStatusChanges } from '../lib/countStatusChanges';
import type { Device } from '../types/device';

const STATUS_SENSOR = 'S1';

/** Fetches S1 history for all devices in one bulk request and counts status transitions per device. */
export async function getStatusChangeCountsByDevice(
  devices: Device[],
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const seriesByDevID = await getBulkDeviceTimeSeries(
    devices.map((d) => ({ devID: d.devID, sensor: STATUS_SENSOR })),
    startMs,
    endMs,
  );

  const result = new Map<string, number>();
  for (const device of devices) {
    result.set(device.devID, countStatusChanges(seriesByDevID.get(device.devID) ?? []));
  }
  return result;
}
