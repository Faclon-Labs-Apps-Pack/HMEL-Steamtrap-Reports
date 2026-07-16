export interface DateRange {
  start: Date;
  end: Date;
}

/** Monday 00:00:00 of the current week through right now (local time), so it never queries into the future. */
export function getCurrentWeekRange(now: Date = new Date()): DateRange {
  const start = new Date(now);
  const day = start.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);

  return { start, end: now };
}

/** Today, 00:00:00 through right now (local time) — used by the Daily Report, which is windowed to "today" per its name and the source template's own 24hr duration. */
export function getTodayRange(now: Date = new Date()): DateRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { start, end: now };
}

/**
 * Expands a range to full calendar-day boundaries: start -> 00:00:00.000 of its day,
 * end -> 23:59:59.999 of its day. Needed because the DatePicker's single-day presets
 * ("Today", "Yesterday") resolve to `start === end` at exactly midnight — a zero-width
 * window that silently returns no data from every time-series query. Confirmed live
 * (2026-07-16): selecting "Today" produced `{start: T00:00:00.000Z, end: T00:00:00.000Z}`.
 */
export function normalizeDateRange(range: DateRange): DateRange {
  const start = new Date(range.start);
  start.setHours(0, 0, 0, 0);

  const end = new Date(range.end);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function toEpochMs(date: Date): number {
  return date.getTime();
}
