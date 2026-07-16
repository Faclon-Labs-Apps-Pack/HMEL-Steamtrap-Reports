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
