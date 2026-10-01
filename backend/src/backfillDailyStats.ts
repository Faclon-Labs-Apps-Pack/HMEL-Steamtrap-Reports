import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import { findDevicesByType } from './services/iosenseApi';
import { ensureDaysIngested, dateKey } from './services/dailyStatsStore';
import { MONITORING_START, getPreviousDayRange } from './lib/dateRange';

/**
 * One-time (and re-runnable) backfill of the daily-stats store: ingests every calendar day from
 * MONITORING_START (1-Sep-2026) through YESTERDAY, one light 24h S1 fetch per missing day. Idempotent
 * — already-stored days are skipped, so it's safe to re-run after a partial run or an outage. Each
 * day is a small, reliable request even while the long-range sweeps fail, so this populates the
 * history the reports then sum for WTD/MTD/YTD.
 *
 * Run:  npx tsx src/backfillDailyStats.ts
 */
async function main(): Promise<void> {
  console.log('[backfill] Loading devices…');
  const devices = await findDevicesByType('steam trap');
  const from = MONITORING_START;
  const to = getPreviousDayRange().end; // yesterday (last fully-completed day)
  console.log(`[backfill] Ingesting ${dateKey(from)} → ${dateKey(to)} for ${devices.length} devices…`);

  const { ingested, skipped } = await ensureDaysIngested(devices, from, to, (m) => console.log(`[backfill] ${m}`));
  console.log(`[backfill] Done. ingested=${ingested} day(s), skipped=${skipped} already-present day(s).`);
}

main().catch((err) => {
  console.error('[backfill] Failed:', err);
  process.exitCode = 1;
});
