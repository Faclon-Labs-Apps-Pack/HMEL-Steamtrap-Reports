import { classifyStatus, STATUS_COLUMNS, type StatusColumn } from './statusClassification';
import { extractDepartmentFromTags } from './departmentTag';
import { derivePlantCategory, UNASSIGNED } from './plantCategory';
import type { Device, LastDataPoint } from '../types/device';

export type StatusCounts = Record<StatusColumn, number>;

function emptyCounts(): StatusCounts {
  return Object.fromEntries(STATUS_COLUMNS.map((col) => [col, 0])) as StatusCounts;
}

export interface UnitRow {
  unitName: string;
  counts: StatusCounts;
  total: number;
}

export interface PlantGroup {
  plantCategory: string;
  units: UnitRow[];
  subtotal: StatusCounts;
  subtotalCount: number;
}

export interface UnitStatusMatrix {
  groups: PlantGroup[];
  grandTotal: StatusCounts;
  grandTotalCount: number;
}

/**
 * Groups devices by their "department:<value>" tag (the report's Unit Name) and counts
 * them per classified S1 status. Plant Category is derived from the unit name via
 * `derivePlantCategory` (falls back to substring match, then "Unassigned").
 */
export function segregateByUnit(devices: Device[], lastDPs: LastDataPoint[]): UnitStatusMatrix {
  const statusByDevID = new Map(lastDPs.map((dp) => [dp.devID, dp.value]));

  const unitsByPlant = new Map<string, Map<string, UnitRow>>();

  for (const device of devices) {
    const unitName = extractDepartmentFromTags(device.tags) ?? UNASSIGNED;
    const plantCategory = derivePlantCategory(unitName);
    const status = classifyStatus(statusByDevID.get(device.devID));

    if (!unitsByPlant.has(plantCategory)) unitsByPlant.set(plantCategory, new Map());
    const units = unitsByPlant.get(plantCategory)!;

    if (!units.has(unitName)) units.set(unitName, { unitName, counts: emptyCounts(), total: 0 });
    const row = units.get(unitName)!;
    row.counts[status] += 1;
    row.total += 1;
  }

  const grandTotal = emptyCounts();
  let grandTotalCount = 0;

  const groups: PlantGroup[] = [...unitsByPlant.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plantCategory, units]) => {
      const subtotal = emptyCounts();
      let subtotalCount = 0;
      const unitRows = [...units.values()].sort((a, b) => a.unitName.localeCompare(b.unitName));

      for (const row of unitRows) {
        for (const col of STATUS_COLUMNS) {
          subtotal[col] += row.counts[col];
          grandTotal[col] += row.counts[col];
        }
        subtotalCount += row.total;
        grandTotalCount += row.total;
      }

      return { plantCategory, units: unitRows, subtotal, subtotalCount };
    });

  return { groups, grandTotal, grandTotalCount };
}
