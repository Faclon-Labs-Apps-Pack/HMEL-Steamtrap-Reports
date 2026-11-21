import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PendingEmail } from '../scheduler/pendingEmails';

// pendingEmails resolves its queue file from OUTPUT_DIR at import time, so point that at a throwaway
// directory BEFORE the module loads — these tests must never touch a real queue.
process.env.REPORT_OUTPUT_DIR = await mkdtemp(path.join(tmpdir(), 'pending-emails-test-'));
const { addPendingEmail, claimPendingEmail, restorePendingEmail, getPendingEmails } = await import(
  '../scheduler/pendingEmails'
);

function entry(fileName: string): PendingEmail {
  return {
    reportType: 'daily',
    section: fileName.replace('.xlsx', ''),
    fileName,
    downloadUrl: `https://example.invalid/report/${fileName}`,
    recipients: ['someone@example.invalid'],
    cc: [],
    subject: fileName,
    reportTitle: 'Steam Trap Daily Report',
    message: 'test',
    generatedAt: new Date().toISOString(),
    sendAt: new Date().toISOString(),
  };
}

async function drain(): Promise<void> {
  for (const e of await getPendingEmails()) await claimPendingEmail(e.fileName);
}

test('re-recording the same report replaces its entry instead of queueing it twice', async () => {
  await drain();
  // A restart makes the catch-up generation re-record an occurrence that is already queued.
  await addPendingEmail(entry('BS6.xlsx'));
  await addPendingEmail(entry('BS6.xlsx'));
  assert.deepEqual((await getPendingEmails()).map((e) => e.fileName), ['BS6.xlsx']);
});

test('only one of two racing senders may claim the same report', async () => {
  await drain();
  const files = ['BS6.xlsx', 'HGU.xlsx', 'MSB.xlsx', 'VGO.xlsx'];
  for (const f of files) await addPendingEmail(entry(f));

  // The 2026-11-17 16:00 incident: startup recovery's per-entry timers and the scheduled send loop
  // both fire for the same occurrence in the same tick.
  const claims = await Promise.all(files.flatMap((f) => [claimPendingEmail(f), claimPendingEmail(f)]));
  const winnersPerFile = files.map((_, i) => claims.slice(i * 2, i * 2 + 2).filter(Boolean).length);

  assert.deepEqual(winnersPerFile, [1, 1, 1, 1]);
  assert.deepEqual(await getPendingEmails(), []);
});

test('a failed send re-queues its entry so recovery retries it', async () => {
  await drain();
  await addPendingEmail(entry('VGO.xlsx'));
  assert.equal(await claimPendingEmail('VGO.xlsx'), true);

  await restorePendingEmail(entry('VGO.xlsx'));
  assert.deepEqual((await getPendingEmails()).map((e) => e.fileName), ['VGO.xlsx']);
  assert.equal(await claimPendingEmail('VGO.xlsx'), true);
});

test('a report already taken by another sender cannot be claimed again', async () => {
  await drain();
  await addPendingEmail(entry('MSB.xlsx'));
  assert.equal(await claimPendingEmail('MSB.xlsx'), true);
  assert.equal(await claimPendingEmail('MSB.xlsx'), false); // the duplicate sender stands down
});

test('an unreadable queue fails open rather than skipping the send', async () => {
  await drain();
  // A missing report is far worse than a duplicate one: if the queue can't be read we cannot prove
  // the send is a duplicate, so it must go through.
  await writeFile(path.join(process.env.REPORT_OUTPUT_DIR!, 'pending-emails.json'), '{ this is not json');
  assert.equal(await claimPendingEmail('BS6.xlsx'), true);
});
