import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PendingEmail } from '../scheduler/pendingEmails';

// Point every directory these modules touch at throwaway dirs BEFORE they load, and keep
// ALERT_RECIPIENTS empty so sendOpsAlert stays a logged no-op instead of emailing anyone.
const workDir = await mkdtemp(path.join(tmpdir(), 'send-failures-test-'));
process.env.REPORT_OUTPUT_DIR = workDir;
process.env.REPORT_ARCHIVE_DIR = workDir;
process.env.REPORT_LOG_DIR = workDir;
process.env.ALERT_RECIPIENTS = '';
process.env.ATTACHMENT_RETRY_INTERVAL_MINUTES = '5';
// Left unset on purpose: these cases assert the SHIPPED defaults (2 attempts, 60 min backstop).
delete process.env.ATTACHMENT_MAX_ATTEMPTS;
delete process.env.ATTACHMENT_RETRY_WINDOW_MINUTES;

const { recordAttachmentFailure, recordQuotaFailure, recordSendFailure, cancelArmedRetries } = await import(
  '../scheduler/sendFailures'
);
const { getPendingEmails, claimPendingEmail } = await import('../scheduler/pendingEmails');
const { SendEmailError } = await import('../email/sendReportEmail');

function entry(overrides: Partial<PendingEmail> = {}): PendingEmail {
  return {
    reportType: 'daily',
    section: 'VGO',
    fileName: 'Steam Trap Daily Report–VGO-18-11-26.xlsx',
    downloadUrl: 'https://example.invalid/report/VGO.xlsx',
    recipients: ['someone@example.invalid'],
    cc: [],
    subject: 'VGO',
    reportTitle: 'Steam Trap Daily Report',
    message: 'test',
    generatedAt: new Date().toISOString(),
    sendAt: new Date().toISOString(),
    ...overrides,
  };
}

async function logLines(): Promise<string[]> {
  const raw = await readFile(path.join(workDir, 'report-log.jsonl'), 'utf8');
  return raw.trim().split('\n');
}

async function lastLog(): Promise<{ status: string; attempt?: number; error?: string }> {
  return JSON.parse((await logLines()).at(-1)!);
}

async function drain(): Promise<void> {
  // Disarm any retry a previous case left waiting — otherwise its timer holds the run open.
  cancelArmedRetries();
  for (const e of await getPendingEmails()) await claimPendingEmail(e.fileName);
}

test.after(() => cancelArmedRetries());

test('the first attachment failure is logged as retrying, not failed', async () => {
  await drain();
  await recordAttachmentFailure(entry(), 'Error: Error in getting attachment data', async () => {});

  const log = await lastLog();
  assert.equal(log.status, 'retrying');
  assert.equal(log.attempt, 1);
  assert.match(log.error!, /retrying in 5 min \(attempt 2 of 2\)/);

  // Still queued, with the retry state persisted so a restart resumes the same countdown.
  const [queued] = await getPendingEmails();
  assert.equal(queued.attempts, 1);
  assert.ok(queued.firstFailureAt, 'the retry deadline is anchored to the first failure');
});

test('each report gets ONE retry — the second failure is final', async () => {
  await drain();
  const started = new Date(Date.now() - 5 * 60_000).toISOString();
  await recordAttachmentFailure(
    entry({ attempts: 1, firstFailureAt: started }),
    'Error: Error in getting attachment data',
    async () => assert.fail('a third send must never be armed'),
  );

  const log = await lastLog();
  assert.equal(log.status, 'failed');
  assert.equal(log.attempt, 2);
  assert.match(log.error!, /gave up after all 2 attempt\(s\)/);
  assert.match(log.error!, /Error in getting attachment data/);
});

test('ATTACHMENT_MAX_ATTEMPTS raises the cap without touching anything else', async () => {
  await drain();
  process.env.ATTACHMENT_MAX_ATTEMPTS = '4';
  try {
    // Attempt 2 of 4 — still inside the raised cap, so it keeps retrying.
    await recordAttachmentFailure(
      entry({ attempts: 1, firstFailureAt: new Date().toISOString() }),
      'attachment gone',
      async () => {},
    );
    assert.equal((await lastLog()).status, 'retrying');
    assert.equal((await lastLog()).attempt, 2);
  } finally {
    delete process.env.ATTACHMENT_MAX_ATTEMPTS;
  }
});

test('the time backstop still stops a raised cap from retrying past the window', async () => {
  await drain();
  process.env.ATTACHMENT_MAX_ATTEMPTS = '99';
  try {
    const started = new Date(Date.now() - 61 * 60_000).toISOString(); // past the 60 min backstop
    await recordAttachmentFailure(
      entry({ attempts: 3, firstFailureAt: started }),
      'attachment gone',
      async () => assert.fail('no retry may be armed once the backstop is passed'),
    );
    const log = await lastLog();
    assert.equal(log.status, 'failed');
    assert.match(log.error!, /gave up after 4 attempt\(s\)/);
  } finally {
    delete process.env.ATTACHMENT_MAX_ATTEMPTS;
  }
});

test('a quota failure fails immediately — no attempts are burned on it', async () => {
  await drain();
  await recordQuotaFailure(entry(), 'IOsense refused to send — email quota exhausted: Not sending email due to no quota');
  const log = await lastLog();
  assert.equal(log.status, 'failed');
  assert.equal(log.attempt, undefined);
  assert.match(log.error!, /quota/i);
  // Left queued so a resend after the quota resets can pick it up.
  assert.equal((await getPendingEmails()).length, 1);
});

test('recordSendFailure routes each IOsense error to the right handling', async () => {
  await drain();
  const attachmentErr = new SendEmailError('could not fetch attachment', 'attachment', [
    'Error: Error in getting attachment data',
  ]);
  await recordSendFailure(entry(), attachmentErr, async () => {});
  assert.equal((await lastLog()).status, 'retrying');

  await drain();
  const quotaErr = new SendEmailError('quota exhausted', 'quota', ['Not sending email due to no quota']);
  await recordSendFailure(entry(), quotaErr, async () => assert.fail('quota must not be retried'));
  assert.equal((await lastLog()).status, 'failed');

  await drain();
  await recordSendFailure(entry(), new Error('HTTP 500 from IOsense'), async () =>
    assert.fail('an unclassified rejection must not be retried'),
  );
  assert.equal((await lastLog()).status, 'failed');
});
