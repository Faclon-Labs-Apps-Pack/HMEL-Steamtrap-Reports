import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler, Response } from 'express';
import { LOG_DIR } from '../config';
import { deriveAccess, type Access, type KnownSection, type RoleEntry } from './access';
import { fetchRoleList, fetchRoleMembers, UpstreamAuthError, UpstreamUnavailableError, type RoleMember } from './iosenseSubUser';

/**
 * Auth for the admin API.
 *
 * Identity model: the IOsense browser token is OPAQUE (5-part custom format — not a decodable
 * JWT), and the account API takes the acting user from the token itself, so we must know which
 * userId belongs to a token WITHOUT trusting the client's word for it (a valid-token holder
 * claiming an admin's id would otherwise pass the "not in any role → admin" rule). Solution:
 * the SSO exchange happens THROUGH OUR BACKEND (POST /api/session/sso-exchange): IOsense's
 * retrieve-sso-token response hands us {token, userId} as a verified pair, which we persist
 * keyed by sha256(token) (never the raw token) in LOG_DIR/session-pairings.json — the one
 * directory proven to survive redeploys. A token with no recorded pairing gets 401 ("open from
 * the IOsense portal"), which is also exactly how users arrive.
 *
 * Per-request: Authorization bearer → pairing → fetchRole WITH THE USER'S TOKEN (validates the
 * session at IOsense AND returns the role list) → deriveAccess → res.locals.access. Results
 * cached 5 min (30 s for failures); IOsense outages are 503, never 401, and never cached.
 *
 * Dev bypass: ADMIN_API_AUTH=off (default on) → everyone is admin, with a loud startup warning.
 */

const PAIRINGS_FILE = path.join(LOG_DIR, 'session-pairings.json');
const PAIRING_CAP = 2000;

interface Pairing {
  userId: string;
  organisation?: string;
  at: string;
}

let pairings: Record<string, Pairing> | null = null;

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

async function loadPairings(): Promise<Record<string, Pairing>> {
  if (pairings) return pairings;
  try {
    pairings = JSON.parse(await readFile(PAIRINGS_FILE, 'utf8'));
  } catch {
    pairings = {};
  }
  return pairings!;
}

async function savePairings(): Promise<void> {
  if (!pairings) return;
  const entries = Object.entries(pairings);
  if (entries.length > PAIRING_CAP) {
    entries.sort((a, b) => (a[1].at < b[1].at ? -1 : 1));
    pairings = Object.fromEntries(entries.slice(entries.length - PAIRING_CAP));
  }
  await mkdir(LOG_DIR, { recursive: true });
  const tmp = `${PAIRINGS_FILE}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(pairings), 'utf8');
  await rename(tmp, PAIRINGS_FILE);
}

/** Records a verified token↔user pairing (called by the /session/sso-exchange route). */
export async function recordPairing(token: string, userId: string, organisation?: string): Promise<void> {
  const map = await loadPairings();
  map[tokenHash(token)] = { userId, organisation, at: new Date().toISOString() };
  await savePairings().catch((err) => console.error('[auth] Could not persist session pairing:', err));
}

export interface SessionInfo {
  userId: string;
  access: Access;
  name?: string;
  email?: string;
  roleNames: string[];
}

interface CacheEntry {
  value?: SessionInfo;
  error?: 'unauthorized' | 'forbidden';
  message?: string;
  expiresAt: number;
}

const sessionCache = new Map<string, CacheEntry>();
const POSITIVE_TTL = 5 * 60_000;
const NEGATIVE_TTL = 30_000;
const CACHE_CAP = 500;

function cacheSet(key: string, entry: Omit<CacheEntry, 'expiresAt'>, ttl: number): void {
  if (sessionCache.size >= CACHE_CAP) {
    const oldest = sessionCache.keys().next().value;
    if (oldest) sessionCache.delete(oldest);
  }
  sessionCache.set(key, { ...entry, expiresAt: Date.now() + ttl });
}

/** Looks up the member record (name/email/active) for this user in their roles; failures are non-fatal. */
async function resolveMember(userId: string, memberRoles: RoleEntry[]): Promise<RoleMember | undefined> {
  for (const role of memberRoles) {
    try {
      const member = (await fetchRoleMembers(role.roleId)).find((m) => m.subUserId === userId);
      if (member) return member;
    } catch {
      // Name/email is a nicety — never block access on it.
    }
  }
  return undefined;
}

/** How long an SSO sign-in stays valid before the user must come through the portal again. */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? '24') * 60 * 60_000;

/**
 * Sub-user role scoping switch (client decision 2026-10-21): for NOW every SSO sign-in gets the
 * full report UI — in practice the portal link is used by the main account. Set SUBUSER_ROLES=on
 * to re-enable per-role scoping (read users → View Reports of their sections only); all the
 * machinery below stays in place for that.
 */
const ROLES_ENABLED = (process.env.SUBUSER_ROLES ?? 'off').trim().toLowerCase() === 'on';

async function buildSession(token: string, sections: KnownSection[]): Promise<CacheEntry> {
  const map = await loadPairings();
  const pairing = map[tokenHash(token)];
  if (!pairing) {
    return { error: 'unauthorized', message: 'Session not recognized — open this app from the IOsense portal.', expiresAt: 0 };
  }
  // The SSO exchange is the authentication event; the pairing it recorded is the session. The
  // exchanged token is a reduced-scope dashboard token that upstream account APIs reject, so
  // per-request upstream validation isn't possible — a TTL bounds the session lifetime instead.
  if (Date.now() - new Date(pairing.at).getTime() > SESSION_TTL_MS) {
    return { error: 'unauthorized', message: 'Session expired — open this app again from the IOsense portal.', expiresAt: 0 };
  }

  // Role scoping disabled for now: a valid SSO sign-in = full access (main-account usage).
  if (!ROLES_ENABLED) {
    return {
      value: { userId: pairing.userId, access: { kind: 'admin' }, roleNames: [] },
      expiresAt: 0,
    };
  }

  // Roles are read org-wide with the backend service token and matched to the SSO-verified
  // userId (the user's own token has no access to account APIs — see iosenseSubUser.ts).
  const roles = await fetchRoleList();
  const { access, memberRoles } = deriveAccess(pairing.userId, roles, sections);

  if (access === null) {
    return {
      error: 'forbidden',
      message: 'Your account has no report access roles — contact your administrator.',
      expiresAt: 0,
    };
  }

  let member: RoleMember | undefined;
  if (memberRoles.length > 0) {
    member = await resolveMember(pairing.userId, memberRoles);
    if (member && !member.active) {
      return { error: 'forbidden', message: 'Your account is suspended or inactive.', expiresAt: 0 };
    }
  }

  return {
    value: {
      userId: pairing.userId,
      access,
      name: member?.name,
      email: member?.email,
      roleNames: memberRoles.map((r) => r.roleName),
    },
    expiresAt: 0,
  };
}

export function getAccess(res: Response): Access {
  return (res.locals.session as SessionInfo).access;
}
export function getSession(res: Response): SessionInfo {
  return res.locals.session as SessionInfo;
}

export const AUTH_ENABLED = (process.env.ADMIN_API_AUTH ?? 'on').trim().toLowerCase() !== 'off';

export function createAuthMiddleware(sections: () => Promise<KnownSection[]>): RequestHandler {
  if (!AUTH_ENABLED) {
    console.warn('[adminApi] *** WARNING: ADMIN_API_AUTH=off — the admin API is UNAUTHENTICATED (dev only). ***');
    return (_req, res, next) => {
      res.locals.session = { userId: 'dev-bypass', access: { kind: 'admin' }, roleNames: [] } satisfies SessionInfo;
      next();
    };
  }

  return (req, res, next) => {
    void (async () => {
      const header = req.headers.authorization ?? '';
      const token = header.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        res.status(401).json({ error: 'Not signed in — open this app from the IOsense portal.' });
        return;
      }
      const key = tokenHash(token);
      let entry = sessionCache.get(key);
      if (!entry || entry.expiresAt < Date.now()) {
        try {
          entry = await buildSession(token, await sections());
          cacheSet(key, entry, entry.value ? POSITIVE_TTL : NEGATIVE_TTL);
        } catch (err) {
          if (err instanceof UpstreamAuthError) {
            // The SERVICE token (PAT) was rejected — a backend configuration problem, never the
            // user's fault. Loud log + 503 so a PAT expiry can't masquerade as "you're logged out".
            console.error(`[auth] SERVICE credential failure while fetching roles: ${err.message}`);
            res.status(503).json({ error: 'The report service could not verify roles (service credential issue) — contact the administrator.' });
            return;
          } else if (err instanceof UpstreamUnavailableError) {
            // Never cached: an IOsense hiccup must not lock users out as "unauthorized".
            res.status(503).json({ error: 'IOsense is unreachable right now — try again shortly.' });
            return;
          } else {
            console.error('[auth] Unexpected session error:', err);
            res.status(503).json({ error: 'Could not verify the session — try again shortly.' });
            return;
          }
        }
      }
      if (entry.error === 'unauthorized') {
        res.status(401).json({ error: entry.message });
        return;
      }
      if (entry.error === 'forbidden') {
        res.status(403).json({ error: entry.message, code: 'no-access' });
        return;
      }
      res.locals.session = entry.value!;
      next();
    })();
  };
}

/** 403 for anyone whose access is not admin (scoped read users). */
export const requireAdmin: RequestHandler = (_req, res, next) => {
  const session = res.locals.session as SessionInfo | undefined;
  if (session?.access.kind !== 'admin') {
    res.status(403).json({ error: 'Your role does not allow this action.' });
    return;
  }
  next();
};
