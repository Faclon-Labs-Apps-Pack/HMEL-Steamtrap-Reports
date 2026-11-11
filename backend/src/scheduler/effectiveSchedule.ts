import {
  dailyTimeToCron,
  weeklyDayTimeToCron,
  dailyUnitKeysFromEnv,
  getDailyDefaultCron,
  getWeeklyDefaultCron,
  envKey,
} from '../config';
import { normalizeHHMM, type Overrides } from './overrides';
import type { DateRange } from '../lib/dateRange';

/**
 * Resolves the LIVE schedule — .env layered with the runtime overrides file — into cron groups the
 * scheduler can run. All pure functions over (overrides, process.env) so the reconciler can call
 * them every tick and the admin UI's "Edit times" changes take effect without a restart, the same
 * fire-time semantics recipients and pauses already have.
 */

export const DEFAULT_CYCLE_TIME = '00:00:00';

/** A unit's effective daily invocation (send) time, HH:MM IST: override > own .env time > shared-default override > shared .env time. */
export function effectiveDailySendTime(unitKey: string, ov: Overrides): string | null {
  const own = ov.sendTimes.get(`${unitKey}_DAILY_TIME`) ?? normalizeHHMM(process.env[`${unitKey}_DAILY_TIME`] ?? '');
  if (own) return own;
  return ov.sendTimes.get('DAILY_REPORT_TIME') ?? normalizeHHMM(process.env.DAILY_REPORT_TIME ?? '');
}

/** A unit's effective data-day boundary, HH:MM:SS (override only — .env has no cycle concept; default midnight). */
export function effectiveCycleTime(unitKey: string, ov: Overrides): string {
  return ov.cycleTimes.get(`${unitKey}_DAILY_CYCLE`) ?? DEFAULT_CYCLE_TIME;
}

export interface DailyCronGroup {
  cron: string;
  /** Known unit keys (env-key form) whose effective send time resolves to this cron. */
  unitKeys: string[];
  /**
   * True for the group running at the shared default time — it also carries every unit NOT
   * enumerated in .env (device-tag-derived units), via excludeUnitKeys at generation time.
   */
  isDefault: boolean;
}

/**
 * Groups every known daily unit by its effective cron. The group at the shared default time is the
 * catch-all (isDefault): at generation it excludes the other groups' units rather than enumerating
 * its own, so units that exist only as device tags keep getting reports exactly as before.
 */
export function buildDailyCronGroups(ov: Overrides): Map<string, DailyCronGroup> {
  const defaultTime = ov.sendTimes.get('DAILY_REPORT_TIME') ?? normalizeHHMM(process.env.DAILY_REPORT_TIME ?? '');
  // DAILY_REPORT_CRON (raw cron in .env) only matters when no HH:MM default exists anywhere.
  const defaultCron = defaultTime ? dailyTimeToCron(defaultTime) : getDailyDefaultCron();

  const groups = new Map<string, DailyCronGroup>();
  if (defaultCron) groups.set(defaultCron, { cron: defaultCron, unitKeys: [], isDefault: true });
  for (const key of dailyUnitKeysFromEnv()) {
    const time = effectiveDailySendTime(key, ov);
    if (!time) continue; // no schedule anywhere for this unit
    const cron = dailyTimeToCron(time);
    const group = groups.get(cron) ?? { cron, unitKeys: [], isDefault: false };
    group.unitKeys.push(key);
    groups.set(cron, group);
  }
  return groups;
}

/** The two client-defined weekly plant categories. */
export const WEEKLY_CATEGORIES = ['Refinery', 'Petchem'];

export interface WeeklyCronGroup {
  cron: string;
  categories: string[];
}

/**
 * Groups the weekly categories by effective cron. The DAY always comes from .env
 * (<CATEGORY>_WEEKLY_DAY or WEEKLY_REPORT_DAY); the TIME can be overridden per category.
 */
export function buildWeeklyCronGroups(ov: Overrides): Map<string, WeeklyCronGroup> {
  const groups = new Map<string, WeeklyCronGroup>();
  for (const category of WEEKLY_CATEGORIES) {
    const key = envKey(category);
    const day = process.env[`${key}_WEEKLY_DAY`]?.trim() || process.env.WEEKLY_REPORT_DAY?.trim();
    const time =
      ov.sendTimes.get(`${key}_WEEKLY_TIME`) ??
      normalizeHHMM(process.env[`${key}_WEEKLY_TIME`] ?? '') ??
      normalizeHHMM(process.env.WEEKLY_REPORT_TIME ?? '');
    let cron: string | null = null;
    if (day && time) cron = weeklyDayTimeToCron(day, time);
    else if (!ov.sendTimes.has(`${key}_WEEKLY_TIME`)) cron = getWeeklyDefaultCron(); // raw-cron .env fallback
    if (!cron) continue;
    const group = groups.get(cron) ?? { cron, categories: [] };
    group.categories.push(category);
    groups.set(cron, group);
  }
  return groups;
}

/**
 * The most recent COMPLETE 24h data day for a cycle boundary: ends at the latest occurrence of
 * `cycleTime` (HH:MM:SS, process-local = IST) at or before `now`, starts 24h earlier. End is held
 * 1ms inside the window, matching getPreviousDayRange's inclusive-end convention — with the default
 * 00:00:00 cycle this returns exactly the previous calendar day, bit-for-bit the old behavior.
 */
export function getCycleDayRange(cycleTime: string, now: Date = new Date()): DateRange {
  const [h, m, s] = cycleTime.split(':').map(Number);
  const boundary = new Date(now);
  boundary.setHours(h, m, s ?? 0, 0);
  if (boundary.getTime() > now.getTime()) boundary.setDate(boundary.getDate() - 1);
  const start = new Date(boundary);
  start.setDate(start.getDate() - 1);
  return { start, end: new Date(boundary.getTime() - 1) };
}
