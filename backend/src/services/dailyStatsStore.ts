import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { STATS_DIR } from '../config';
import { STATUS_COLUMNS, type StatusColumn } from '../lib/statusClassification';
import {
  getStatCountsByDevice,
  countsToStats,
  type DeviceStatCounts,
  type DeviceTimeSeriesStats,
} from './deviceTimeSeriesStats';
import type { Device } from '../types/device';

/**
 * Daily-stats cache. Stores one JSON file per calendar day (IST) of per-device S1 status COUNTS,
 * so WTD/MTD/YTD can be rebuilt by SUMMING daily buckets instead of re-sweeping the whole range
 * from IOsense's flaky getAutoDownSampledData every run. Counts are additive across days (unlike
 * percentages), so a long window = the sum of its days. One file per day keeps ingestion idempotent
 * (re-ingesting a day just overwrites it) and reads a simple date-range glob.
 *
 * File: <STATS_DIR>/YYYY-MM-DD.json = { "<devID>": { statusChangeCount, counts:{<status>:n}, totalPoints } }
 *
 * The process is pinned to IST (setTimezone), so Date's local getFullYear/Month/Date give IST days.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** IST calendar-day key for a Date, e.g. "2026-10-01". */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The 00:00:00.000 → 23:59:59.999 IST epoch-ms range for a YYYY-MM-DD key. */
function dayRangeMs(key: string): { startMs: number; endMs: number } {
  const [y, m, d] = key.split('-').map(Number);
  return {
    startMs: new Date(y, m - 1, d, 0, 0, 0, 0).getTime(),
    endMs: new Date(y, m - 1, d, 23, 59, 59, 999).getTime(),
  };
}

/** Every IST date key from `from` to `to` inclusive (by calendar day). */
export function eachDateKey(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur <= last) {
    keys.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

function emptyCounts(): Record<StatusColumn, number> {
  return Object.fromEntries(STATUS_COLUMNS.map((c) => [c, 0])) as Record<StatusColumn, number>;
}

function filePath(key: string): string {
  return path.join(STATS_DIR, `${key}.json`);
}

export function hasDay(key: string): boolean {
  return existsSync(filePath(key));
}

/** Reads one day's stored counts, or null if that day isn't stored / is unreadable. */
export function readDay(key: string): Map<string, DeviceStatCounts> | null {
  try {
    const obj = JSON.parse(readFileSync(filePath(key), 'utf8')) as Record<string, DeviceStatCounts>;
    return new Map(Object.entries(obj));
  } catch {
    return null;
  }
}

/** Writes (overwrites) one day's counts, atomically (tmp + rename) so a crash can't corrupt a file. */
export async function writeDay(key: string, counts: Map<string, DeviceStatCounts>): Promise<void> {
  await mkdir(STATS_DIR, { recursive: true });
  const tmp = path.join(STATS_DIR, `.${key}.json.tmp`);
  await writeFile(tmp, JSON.stringify(Object.fromEntries(counts)));
  await rename(tmp, filePath(key));
}

/**
 * Sums the stored daily buckets over [from, to] (inclusive, by IST day) into the percentage-based
 * stats the reports consume — the drop-in replacement for a live getTimeSeriesStatsByDevice sweep.
 * Days with no stored file are simply skipped (treated as no readings); use ensureDaysIngested first
 * to fill gaps. Every requested device is present in the result (zero-stats if it has no data).
 */
export function aggregateStatsFromStore(from: Date, to: Date, devIDs: string[]): Map<string, DeviceTimeSeriesStats> {
  const summed = new Map<string, DeviceStatCounts>();
  for (const key of eachDateKey(from, to)) {
    const day = readDay(key);
    if (!day) continue;
    for (const [devID, c] of day) {
      const agg = summed.get(devID) ?? { statusChangeCount: 0, counts: emptyCounts(), totalPoints: 0 };
      agg.statusChangeCount += c.statusChangeCount ?? 0;
      agg.totalPoints += c.totalPoints ?? 0;
      for (const col of STATUS_COLUMNS) agg.counts[col] += c.counts?.[col] ?? 0;
      summed.set(devID, agg);
    }
  }
  const out = new Map<string, DeviceTimeSeriesStats>();
  for (const devID of devIDs) {
    out.set(devID, countsToStats(summed.get(devID) ?? { statusChangeCount: 0, counts: emptyCounts(), totalPoints: 0 }));
  }
  return out;
}

/**
 * Ensures every day in [from, to] has a stored bucket, ingesting any that are missing with a single
 * light 24h S1 fetch per day (reliable even when long-range sweeps fail). Idempotent: existing days
 * are skipped. This is the catch-up that keeps WTD/MTD/YTD complete across outages, and also the
 * one-time backfill when run from 1-Sep.
 */
export async function ensureDaysIngested(
  devices: Device[],
  from: Date,
  to: Date,
  onProgress?: (msg: string) => void,
): Promise<{ ingested: number; skipped: number }> {
  let ingested = 0;
  let skipped = 0;
  for (const key of eachDateKey(from, to)) {
    if (hasDay(key)) {
      skipped++;
      continue;
    }
    onProgress?.(`Ingesting daily stats for ${key}…`);
    const { startMs, endMs } = dayRangeMs(key);
    const counts = await getStatCountsByDevice(devices, startMs, endMs);
    await writeDay(key, counts);
    ingested++;
  }
  return { ingested, skipped };
}

/** Computes + stores one specific day (used to persist the daily report's own DTD sweep). */
export async function ingestDay(devices: Device[], day: Date): Promise<void> {
  const key = dateKey(day);
  const { startMs, endMs } = dayRangeMs(key);
  await writeDay(key, await getStatCountsByDevice(devices, startMs, endMs));
}
