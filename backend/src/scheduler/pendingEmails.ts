import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUT_DIR } from '../config';

export interface PendingEmail {
  reportType: 'weekly' | 'daily';
  /** The unit (daily) or plant category (weekly) this report is for — used in the send log. */
  section: string;
  fileName: string;
  downloadUrl: string;
  recipients: string[];
  /** CC recipients (copied on the email). Optional for backward compatibility with older queued entries. */
  cc?: string[];
  subject: string;
  reportTitle: string;
  message: string;
  /** When the report was generated and written to disk. */
  generatedAt: string;
  /** The exact configured schedule instant this should be emailed at (ISO). */
  sendAt: string;
  /**
   * Attachment-retry state (see `sendFailures.ts`). Persisted with the entry so a restart mid-retry
   * resumes the same countdown instead of starting a fresh hour:
   *  - attempts       — failed send attempts so far
   *  - firstFailureAt — when the FIRST attachment failure happened; the retry window runs from here
   */
  attempts?: number;
  firstFailureAt?: string;
}

const PENDING_FILE = path.join(OUTPUT_DIR, 'pending-emails.json');

async function readAll(): Promise<PendingEmail[]> {
  try {
    const raw = await readFile(PENDING_FILE, 'utf-8');
    return JSON.parse(raw) as PendingEmail[];
  } catch {
    return [];
  }
}

async function writeAll(entries: PendingEmail[]): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(PENDING_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Serializes every read-modify-write of the queue file. Node is single-threaded, but each `await`
 * inside readAll/writeAll yields — so two sends firing in the same tick could both read the queue,
 * both filter their own entry out, and both write, each believing it had claimed the entry. Chaining
 * the operations makes add/claim atomic within this process, which is exactly what
 * `claimPendingEmail` relies on to let only ONE of two racing senders through.
 */
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(op: () => Promise<T>): Promise<T> {
  const run = queueLock.then(op, op);
  queueLock = run.catch(() => undefined); // a failed op must not poison the chain
  return run;
}

/** Adds `entry`, replacing any existing entry for the same file so the queue can't hold duplicates. */
async function upsert(entry: PendingEmail): Promise<void> {
  const entries = await readAll();
  await writeAll([...entries.filter((e) => e.fileName !== entry.fileName), entry]);
}

/**
 * Records a report as generated and awaiting its scheduled send — persisted to disk (not just
 * kept in memory) so that if the process restarts between generation and the scheduled send time
 * (e.g. a deploy), the send isn't silently lost — see `recoverPendingEmails` in `scheduler.ts`.
 *
 * Keyed by fileName: re-recording the same report (a restart makes the catch-up generation re-run an
 * occurrence that already has a queued entry) REPLACES it rather than queueing it twice.
 */
export async function addPendingEmail(entry: PendingEmail): Promise<void> {
  await withQueueLock(() => upsert(entry));
  console.log(`[pendingEmails] Recorded ${entry.fileName}, due to send at ${entry.sendAt}`);
}

/** Puts an entry back after its send failed, so startup recovery retries it. */
export async function restorePendingEmail(entry: PendingEmail): Promise<void> {
  await withQueueLock(() => upsert(entry));
  console.log(`[pendingEmails] Re-queued ${entry.fileName} after a failed send — recovery will retry it.`);
}

/**
 * Takes ownership of one queued report: removes its entry and reports whether THIS caller is the one
 * that got it. `false` means another sender already took it, so the caller must not send.
 *
 * This is the guard against double-sending. The same occurrence can legitimately have two senders in
 * one process — startup recovery arms a timer per queued entry, and the restart's catch-up generation
 * separately schedules the same occurrence — and report files are one-shot (the file server deletes
 * each one after IOsense fetches it). Whichever sender lost that race used to produce a bogus
 * "report NOT delivered" alert for a report that had in fact just gone out.
 *
 * FAILS OPEN: if the queue file can't be read we cannot prove the send is a duplicate, and a missing
 * report is far worse than a duplicate one, so the send is allowed through.
 */
export async function claimPendingEmail(fileName: string): Promise<boolean> {
  return withQueueLock(async () => {
    let entries: PendingEmail[];
    try {
      entries = JSON.parse(await readFile(PENDING_FILE, 'utf-8')) as PendingEmail[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[pendingEmails] Could not read the queue to claim ${fileName} — allowing the send (fail-open):`, err);
      }
      return true;
    }
    const remaining = entries.filter((e) => e.fileName !== fileName);
    if (remaining.length === entries.length) return false;
    await writeAll(remaining);
    return true;
  });
}

export async function getPendingEmails(): Promise<PendingEmail[]> {
  return readAll();
}
