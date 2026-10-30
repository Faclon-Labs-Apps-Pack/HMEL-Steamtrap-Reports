import type { TimeSeriesPoint } from '../services/iosenseApi';

/** Counts how many times the value differs from the immediately preceding point, in time order. */
export function countStatusChanges(points: TimeSeriesPoint[]): number {
  const sorted = [...points].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  let changes = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].value !== sorted[i - 1].value) changes += 1;
  }
  return changes;
}

/**
 * Per-status breakdown of the total change count: how many times the device changed INTO each status
 * over the window. A "change into X" is a point whose status label is X and whose immediately
 * preceding (in time) point had a DIFFERENT label. `labelOf` maps a raw S1 code to the report's
 * status label first, so changes are counted on classified/grouped labels (e.g. a 1->3 reading,
 * both "Normal", is not a change), keeping these consistent with the grouped status columns. Keys
 * are whatever labels `labelOf` produces.
 */
export function countChangesIntoStatus(
  points: TimeSeriesPoint[],
  labelOf: (value: number) => string,
): Record<string, number> {
  const sorted = [...points].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const changesInto: Record<string, number> = {};
  for (let i = 1; i < sorted.length; i++) {
    const current = labelOf(sorted[i].value);
    const previous = labelOf(sorted[i - 1].value);
    if (current !== previous) changesInto[current] = (changesInto[current] ?? 0) + 1;
  }
  return changesInto;
}
