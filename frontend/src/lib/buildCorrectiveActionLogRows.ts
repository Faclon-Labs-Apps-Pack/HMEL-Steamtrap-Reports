import { extractDepartmentFromTags } from './departmentTag';
import { UNASSIGNED } from './plantCategory';
import type { Device } from '../types/device';
import type { CorrectiveActionRecord } from '../services/correctiveActionApi';

export interface CorrectiveActionLogRow {
  id: string;
  name: string;
  unitName: string;
  location: string;
  manufacturer: string;
  trapSize: string;
  failure: string;
  correctiveAction: string;
  dateAndTime: string;
  remark: string;
  [key: string]: unknown;
}

export function buildCorrectiveActionLogRows(
  records: CorrectiveActionRecord[],
  devices: Device[],
): CorrectiveActionLogRow[] {
  const unitByDevID = new Map(devices.map((d) => [d.devID, extractDepartmentFromTags(d.tags) ?? UNASSIGNED]));

  return records
    .map((record, index) => ({
      id: `${record.devId}-${index}-${record.dateAndTime}`,
      name: record.devName,
      unitName: unitByDevID.get(record.devId) ?? UNASSIGNED,
      location: record.location,
      manufacturer: record.manufacturer,
      trapSize: record.trapSize,
      failure: record.failure,
      correctiveAction: record.correctiveAction,
      dateAndTime: record.dateAndTime,
      remark: record.remark,
    }))
    .sort((a, b) => new Date(b.dateAndTime).getTime() - new Date(a.dateAndTime).getTime());
}
