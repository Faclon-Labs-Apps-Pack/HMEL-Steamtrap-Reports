import { extractDepartmentFromTags } from './departmentTag';
import { derivePlantCategory, UNASSIGNED } from './plantCategory';
import type { Device } from '../types/device';
import type { CorrectiveActionRecord } from '../services/correctiveActionApi';

export function buildCorrectiveActionCountByDevice(records: CorrectiveActionRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.devId, (counts.get(record.devId) ?? 0) + 1);
  }
  return counts;
}

export interface CorrectiveActionUnitRow {
  unitName: string;
  correctiveActionCount: number;
  statusChangeCount: number;
}

export interface CorrectiveActionPlantGroup {
  plantCategory: string;
  units: CorrectiveActionUnitRow[];
  subtotalCorrectiveActions: number;
  subtotalStatusChanges: number;
}

export interface CorrectiveActionMatrixData {
  groups: CorrectiveActionPlantGroup[];
  grandTotalCorrectiveActions: number;
  grandTotalStatusChanges: number;
}

/** Groups devices by Plant Category -> Unit Name (same department-tag derivation as segregateByUnit), summing corrective-action and status-change counts per unit. */
export function segregateCorrectiveActionsAndChanges(
  devices: Device[],
  correctiveActionCountByDevID: Map<string, number>,
  statusChangeCountByDevID: Map<string, number>,
): CorrectiveActionMatrixData {
  const unitsByPlant = new Map<string, Map<string, CorrectiveActionUnitRow>>();

  for (const device of devices) {
    const unitName = extractDepartmentFromTags(device.tags) ?? UNASSIGNED;
    const plantCategory = derivePlantCategory(unitName);

    if (!unitsByPlant.has(plantCategory)) unitsByPlant.set(plantCategory, new Map());
    const units = unitsByPlant.get(plantCategory)!;

    if (!units.has(unitName)) {
      units.set(unitName, { unitName, correctiveActionCount: 0, statusChangeCount: 0 });
    }
    const row = units.get(unitName)!;
    row.correctiveActionCount += correctiveActionCountByDevID.get(device.devID) ?? 0;
    row.statusChangeCount += statusChangeCountByDevID.get(device.devID) ?? 0;
  }

  let grandTotalCorrectiveActions = 0;
  let grandTotalStatusChanges = 0;

  const groups: CorrectiveActionPlantGroup[] = [...unitsByPlant.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plantCategory, units]) => {
      const unitRows = [...units.values()].sort((a, b) => a.unitName.localeCompare(b.unitName));
      const subtotalCorrectiveActions = unitRows.reduce((sum, u) => sum + u.correctiveActionCount, 0);
      const subtotalStatusChanges = unitRows.reduce((sum, u) => sum + u.statusChangeCount, 0);

      grandTotalCorrectiveActions += subtotalCorrectiveActions;
      grandTotalStatusChanges += subtotalStatusChanges;

      return { plantCategory, units: unitRows, subtotalCorrectiveActions, subtotalStatusChanges };
    });

  return { groups, grandTotalCorrectiveActions, grandTotalStatusChanges };
}
