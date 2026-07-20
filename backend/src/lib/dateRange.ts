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

/** Monday 00:00:00 through Sunday 23:59:59.999 of the week before the current one (local time) — used by the Management Report, which reports on the last fully-completed week rather than the still in-progress current week. */
export function getLastWeekRange(now: Date = new Date()): DateRange {
  const currentWeekStart = new Date(now);
  const day = currentWeekStart.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  currentWeekStart.setDate(currentWeekStart.getDate() - daysSinceMonday);
  currentWeekStart.setHours(0, 0, 0, 0);

  const start = new Date(currentWeekStart);
  start.setDate(start.getDate() - 7);

  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * 1st 00:00:00.000 through the last day 23:59:59.999 of the month before the current one (local
 * time) — used by the Monthly Management Report, mirroring `getLastWeekRange`'s "report on the
 * last fully-completed period, not the still in-progress current one" philosophy.
 */
export function getLastMonthRange(now: Date = new Date()): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); // day 0 of this month = last day of last month
  return { start, end };
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
