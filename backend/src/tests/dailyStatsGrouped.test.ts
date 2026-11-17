import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// STATS_DIR derives from REPORT_LOG_DIR at config import time — point it at a scratch dir BEFORE
// the store module loads, so these tests never touch real buckets.
process.env.REPORT_LOG_DIR = mkdtempSync(path.join(os.tmpdir(), 'stats-grouped-test-'));
const { writeDay, aggregateStatsFromStore, dayHasGroupedCounts } = await import('../services/dailyStatsStore');
const { STATUS_COLUMNS } = await import('../lib/statusClassification');
type Counts = import('../services/deviceTimeSeriesStats').DeviceStatCounts;

const zeroCounts = () => Object.fromEntries(STATUS_COLUMNS.map((c) => [c, 0])) as Counts['counts'];

function bucket(partial: Partial<Counts>): Counts {
  return { statusChangeCount: 0, counts: zeroCounts(), totalPoints: 0, ...partial };
}

test('grouped change counts sum across new-format days', async () => {
  await writeDay('2026-11-10', new Map([['DEV1', bucket({ statusChangeCount: 7, changesIntoStatus: { Leak: 2 }, groupedChangeCount: 2 })]]));
  await writeDay('2026-11-11', new Map([['DEV1', bucket({ statusChangeCount: 4, changesIntoStatus: { Normal: 1, Leak: 1 }, groupedChangeCount: 2 })]]));
  const stats = aggregateStatsFromStore(new Date(2026, 10, 10), new Date(2026, 10, 11), ['DEV1']).get('DEV1')!;
  assert.equal(stats.statusChangeCount, 11); // raw still sums
  assert.equal(stats.groupedChangeCount, 4);
  assert.deepEqual(stats.changesIntoStatus, { Leak: 3, Normal: 1 });
  assert.equal(dayHasGroupedCounts('2026-11-10'), true);
});

test('a window containing an old-format day reports grouped as unavailable', async () => {
  // 2026-11-09 written without the grouped fields (pre-2026-11-13 bucket).
  await writeDay('2026-11-09', new Map([['DEV1', bucket({ statusChangeCount: 9 })]]));
  assert.equal(dayHasGroupedCounts('2026-11-09'), false);
  const stats = aggregateStatsFromStore(new Date(2026, 10, 9), new Date(2026, 10, 11), ['DEV1']).get('DEV1')!;
  assert.equal(stats.statusChangeCount, 20); // raw fallback stays correct
  assert.equal(stats.groupedChangeCount, undefined); // no silent partial sum
  assert.equal(stats.changesIntoStatus, undefined);
});

test('a device with no stored data still comes back zeroed with grouped intact', () => {
  const stats = aggregateStatsFromStore(new Date(2026, 10, 10), new Date(2026, 10, 11), ['GHOST']).get('GHOST')!;
  assert.equal(stats.statusChangeCount, 0);
  assert.equal(stats.groupedChangeCount, undefined); // never ingested → nothing to claim
});
