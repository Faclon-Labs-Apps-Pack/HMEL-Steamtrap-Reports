import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived HMAC-signed download URLs.
 *
 * Report downloads are plain <a href> links, which cannot carry an Authorization header — so
 * instead of putting the user's long-lived IOsense JWT in a query string (it would leak via
 * access logs, browser history and copy-pasted links), authorized JSON responses MINT a URL
 * signed for exactly one file with a 30-minute expiry. Authorization is by construction: the
 * server only mints URLs for rows it is already returning to that user, and /report-log is
 * force-scoped per role — so a scoped user can never hold a valid signature for another unit's
 * file. A table Refresh re-mints fresh links.
 *
 * Secret: DOWNLOAD_SIGNING_SECRET env, else a per-process random — minting and verification
 * happen in the same process, so no configuration is required; a restart merely invalidates
 * outstanding links until the next refresh.
 */
const SECRET = process.env.DOWNLOAD_SIGNING_SECRET?.trim() || randomUUID();

export type DownloadKind = 'archive' | 'generated';

const DEFAULT_TTL_MS = 30 * 60_000;

function sign(kind: DownloadKind, fileName: string, exp: number): string {
  return createHmac('sha256', SECRET).update(`${kind}|${fileName}|${exp}`).digest('hex');
}

/** Relative URL path for one file, valid for `ttlMs` (default 30 min). */
export function mintDownloadPath(kind: DownloadKind, fileName: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  return `/api/${kind}/${encodeURIComponent(fileName)}?exp=${exp}&sig=${sign(kind, fileName, exp)}`;
}

/** True only for an unexpired, untampered signature over this exact kind+fileName. */
export function verifyDownload(kind: DownloadKind, fileName: string, exp: unknown, sig: unknown): boolean {
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = sign(kind, fileName, expMs);
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
