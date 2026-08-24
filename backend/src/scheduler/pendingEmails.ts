import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUT_DIR } from '../config';

export interface PendingEmail {
  reportType: 'weekly' | 'daily';
  fileName: string;
  downloadUrl: string;
  recipients: string[];
  subject: string;
  reportTitle: string;
  message: string;
  /** When the report was generated and written to disk. */
  generatedAt: string;
  /** The exact configured schedule instant this should be emailed at (ISO). */
  sendAt: string;
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
 * Records a report as generated and awaiting its scheduled send — persisted to disk (not just
 * kept in memory) so that if the process restarts between generation and the scheduled send time
 * (e.g. a deploy), the send isn't silently lost — see `recoverPendingEmails` in `scheduler.ts`.
 */
export async function addPendingEmail(entry: PendingEmail): Promise<void> {
  const entries = await readAll();
  entries.push(entry);
  await writeAll(entries);
  console.log(`[pendingEmails] Recorded ${entry.fileName}, due to send at ${entry.sendAt}`);
}

/** Removes an entry once its email has actually been sent. */
export async function removePendingEmail(fileName: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((e) => e.fileName !== fileName));
}

export async function getPendingEmails(): Promise<PendingEmail[]> {
  return readAll();
}
