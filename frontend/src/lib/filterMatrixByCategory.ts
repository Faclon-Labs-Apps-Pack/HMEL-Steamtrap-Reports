import type { UnitStatusMatrix } from './segregateByUnit';
import type { CorrectiveActionMatrixData } from './segregateCorrectiveActions';

/** Scopes a UnitStatusMatrix down to a single plant category, for per-category Weekly Report sections. */
export function filterUnitStatusMatrixByCategory(matrix: UnitStatusMatrix, plantCategory: string): UnitStatusMatrix {
  const group = matrix.groups.find((g) => g.plantCategory === plantCategory);
  if (!group) {
    return { groups: [], grandTotal: matrix.grandTotal, grandTotalCount: 0 };
  }
  return { groups: [group], grandTotal: group.subtotal, grandTotalCount: group.subtotalCount };
}

/** Scopes a CorrectiveActionMatrixData down to a single plant category. */
export function filterCorrectiveActionMatrixByCategory(
  matrix: CorrectiveActionMatrixData,
  plantCategory: string,
): CorrectiveActionMatrixData {
  const group = matrix.groups.find((g) => g.plantCategory === plantCategory);
  if (!group) {
    return { groups: [], grandTotalCorrectiveActions: 0, grandTotalStatusChanges: 0 };
  }
  return {
    groups: [group],
    grandTotalCorrectiveActions: group.subtotalCorrectiveActions,
    grandTotalStatusChanges: group.subtotalStatusChanges,
  };
}
