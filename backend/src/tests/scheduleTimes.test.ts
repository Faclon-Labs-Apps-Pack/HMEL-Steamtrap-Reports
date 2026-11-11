import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOverrides,
  serializeOverrides,
  emptyOverrides,
  overrideSendTime,
  overrideCycleTime,
  normalizeHHMM,
  normalizeHHMMSS,
} from '../scheduler/overrides';
import {
  effectiveDailySendTime,
  effectiveCycleTime,
  buildDailyCronGroups,
  buildWeeklyCronGroups,
  getCycleDayRange,
  DEFAULT_CYCLE_TIME,
} from '../scheduler/effectiveSchedule';
import { getPreviousDayRange } from '../lib/dateRange';

test('parseOverrides: send-time and cycle directives', () => {
  const ov = parseOverrides(
    [
      'CPP_575_DAILY_TIME: 9:00',
      'REFINERY_WEEKLY_TIME: 09:30',
      'CPP_575_DAILY_CYCLE: 6:00',
      'HGU_DAILY_CYCLE: 06:30:15',
      'BAD_DAILY_TIME: 25:00',
      'WORSE_DAILY_CYCLE: six',
    ].join('\n'),
  );
  assert.equal(ov.sendTimes.get('CPP_575_DAILY_TIME'), '09:00'); // normalized
  assert.equal(ov.sendTimes.get('REFINERY_WEEKLY_TIME'), '09:30');
  assert.equal(ov.cycleTimes.get('CPP_575_DAILY_CYCLE'), '06:00:00'); // seconds added
  assert.equal(ov.cycleTimes.get('HGU_DAILY_CYCLE'), '06:30:15');
  assert.equal(ov.errors.length, 2); // the two invalid times, fail-open
  assert.equal(overrideSendTime(ov, 'CPP 575', 'daily'), '09:00');
  assert.equal(overrideCycleTime(ov, 'CPP 575'), '06:00:00');
  assert.equal(overrideSendTime(ov, 'HGU', 'daily'), null);
});

test('serializeOverrides round-trips times', () => {
  const ov = emptyOverrides();
  ov.sendTimes.set('CPP_575_DAILY_TIME', '09:00');
  ov.cycleTimes.set('CPP_575_DAILY_CYCLE', '06:00:00');
  const back = parseOverrides(serializeOverrides(ov));
  assert.equal(back.errors.length, 0);
  assert.equal(back.sendTimes.get('CPP_575_DAILY_TIME'), '09:00');
  assert.equal(back.cycleTimes.get('CPP_575_DAILY_CYCLE'), '06:00:00');
});

test('normalizers', () => {
  assert.equal(normalizeHHMM('8:05'), '08:05');
  assert.equal(normalizeHHMM('24:00'), null);
  assert.equal(normalizeHHMMSS('8:05'), '08:05:00');
  assert.equal(normalizeHHMMSS('08:05:61'), null);
});

test('effective daily send time: override > own env > shared env', () => {
  process.env.DAILY_REPORT_TIME = '08:00';
  process.env.TESTUNIT_DAILY_RECIPIENTS = 'a@x.in';
  process.env.TESTOWN_DAILY_TIME = '07:30';
  try {
    const none = emptyOverrides();
    assert.equal(effectiveDailySendTime('TESTUNIT', none), '08:00'); // shared default
    assert.equal(effectiveDailySendTime('TESTOWN', none), '07:30'); // own env time
    const ov = emptyOverrides();
    ov.sendTimes.set('TESTUNIT_DAILY_TIME', '09:15');
    assert.equal(effectiveDailySendTime('TESTUNIT', ov), '09:15'); // override wins
    assert.equal(effectiveCycleTime('TESTUNIT', ov), DEFAULT_CYCLE_TIME);
  } finally {
    delete process.env.TESTUNIT_DAILY_RECIPIENTS;
    delete process.env.TESTOWN_DAILY_TIME;
  }
});

test('buildDailyCronGroups: default catch-all plus override groups', () => {
  process.env.DAILY_REPORT_TIME = '08:00';
  process.env.TESTUNIT_DAILY_RECIPIENTS = 'a@x.in';
  process.env.TESTB_DAILY_RECIPIENTS = 'b@x.in';
  try {
    const ov = emptyOverrides();
    ov.sendTimes.set('TESTUNIT_DAILY_TIME', '09:15');
    const groups = buildDailyCronGroups(ov);
    const def = groups.get('0 8 * * *');
    const own = groups.get('15 9 * * *');
    assert.ok(def && def.isDefault, 'default group exists');
    assert.ok(def.unitKeys.includes('TESTB'));
    assert.ok(!def.unitKeys.includes('TESTUNIT'));
    assert.ok(own && !own.isDefault);
    assert.deepEqual(own.unitKeys, ['TESTUNIT']);
  } finally {
    delete process.env.TESTUNIT_DAILY_RECIPIENTS;
    delete process.env.TESTB_DAILY_RECIPIENTS;
  }
});

test('buildWeeklyCronGroups: shared day, per-category time override', () => {
  process.env.WEEKLY_REPORT_DAY = 'Monday';
  process.env.WEEKLY_REPORT_TIME = '08:30';
  const none = emptyOverrides();
  const shared = buildWeeklyCronGroups(none);
  assert.equal(shared.size, 1);
  assert.deepEqual([...shared.values()][0].categories, ['Refinery', 'Petchem']);

  const ov = emptyOverrides();
  ov.sendTimes.set('REFINERY_WEEKLY_TIME', '09:30');
  const split = buildWeeklyCronGroups(ov);
  assert.equal(split.size, 2);
  assert.deepEqual(split.get('30 9 * * 1')?.categories, ['Refinery']);
  assert.deepEqual(split.get('30 8 * * 1')?.categories, ['Petchem']);
});

test('getCycleDayRange: 00:00:00 equals getPreviousDayRange exactly', () => {
  const now = new Date(2026, 10, 11, 14, 30, 0); // 11-Nov-2026 14:30 local
  const cycle = getCycleDayRange('00:00:00', now);
  const prev = getPreviousDayRange(now);
  assert.equal(cycle.start.getTime(), prev.start.getTime());
  assert.equal(cycle.end.getTime(), prev.end.getTime());
});

test('getCycleDayRange: 06:00 boundary, before and after', () => {
  // After today's boundary: window = yesterday 06:00 -> today 06:00 (minus 1ms)
  const afternoon = new Date(2026, 10, 11, 7, 45, 0);
  const a = getCycleDayRange('06:00:00', afternoon);
  assert.equal(a.start.getTime(), new Date(2026, 10, 10, 6, 0, 0).getTime());
  assert.equal(a.end.getTime(), new Date(2026, 10, 11, 6, 0, 0).getTime() - 1);
  // Before today's boundary: last complete cycle ended yesterday 06:00
  const dawn = new Date(2026, 10, 11, 5, 0, 0);
  const b = getCycleDayRange('06:00:00', dawn);
  assert.equal(b.start.getTime(), new Date(2026, 10, 9, 6, 0, 0).getTime());
  assert.equal(b.end.getTime(), new Date(2026, 10, 10, 6, 0, 0).getTime() - 1);
});
