import { API_BASE, getAuthHeader } from '../config';
import type { RoleEntry } from './access';

/**
 * The ONLY file that talks to IOsense's account/sub-user API (on connector — the same host the
 * rest of the app uses; appserver.iosense.io is NOT used, per client instruction).
 *
 * Contract (captured from the portal's own traffic and verified live on connector):
 *   PUT {API_BASE}/account/subuser/fetchRole/<page>/<pageSize>   body {"search":{}}
 *       → { success, data: { totalCount, data: [ { _id, roleName, subUsers[] … } ] } }
 *   PUT {API_BASE}/account/subuser/child/<roleId>/<page>/<pageSize>
 *       → { success, data: { totalCount, data: [ { _id, email, userDetail…, isSubuserActive,
 *            isSubuserSuspended, status } ] } }
 * The pagination segments are REQUIRED — without them the route 404s.
 *
 * WHY THE PAT (service account) AND NOT THE USER'S TOKEN: the session token minted by the SSO
 * exchange is a reduced-scope dashboard token — connector rejects it on these account APIs
 * (verified 2026-10-19), while the portal's own cookie session works. So identity comes from
 * the SSO exchange (authentication stays SSO), and the ROLE LIST is read org-wide with the
 * backend's service token, then matched to the SSO-verified userId. A PAT failure here is a
 * SERVICE problem (treated as 503 upstream-unavailable), never a user-auth failure.
 */

const ACCOUNT_API_BASE = (process.env.IOSENSE_ACCOUNT_API_BASE ?? API_BASE).replace(/\/$/, '');

/** The service credential (PAT) was rejected — a backend configuration problem, not a user problem. */
export class UpstreamAuthError extends Error {}
/** IOsense unreachable or 5xx (→ our 503; never cached, never grants access). */
export class UpstreamUnavailableError extends Error {}

async function put(path: string, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        authorization: getAuthHeader(),
        'content-type': 'application/json',
        'ngsw-bypass': 'true',
        origin: 'https://iosense.io',
        referer: 'https://iosense.io/',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new UpstreamUnavailableError(`IOsense account API unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamAuthError(`IOsense rejected the service token (${res.status}) — check IOSENSE_PAT.`);
  }
  if (!res.ok && res.status >= 500) {
    throw new UpstreamUnavailableError(`IOsense account API error ${res.status}.`);
  }
  const json: any = await res.json().catch(() => null);
  if (!json || json.success === false) {
    throw new UpstreamAuthError(`IOsense: ${json?.error ?? json?.errors?.[0] ?? `HTTP ${res.status}`}`);
  }
  return json;
}

const PAGE_SIZE = 50;
const MAX_PAGES = 50;
const ROLE_CACHE_TTL = 5 * 60_000;

let roleCache: { roles: RoleEntry[]; expiresAt: number } | null = null;

/** All roles of the org with their member sub-user ids — paginated on totalCount, cached 5 min. */
export async function fetchRoleList(): Promise<RoleEntry[]> {
  if (roleCache && roleCache.expiresAt > Date.now()) return roleCache.roles;
  const roles: RoleEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await put(`/account/subuser/fetchRole/${page}/${PAGE_SIZE}`, { search: {} });
    const batch: any[] = json?.data?.data ?? [];
    for (const r of batch) {
      roles.push({
        roleId: String(r._id ?? ''),
        roleName: String(r.roleName ?? ''),
        subUsers: Array.isArray(r.subUsers) ? r.subUsers.map(String) : [],
      });
    }
    const total = Number(json?.data?.totalCount ?? roles.length);
    if (roles.length >= total || batch.length === 0) break;
  }
  roleCache = { roles, expiresAt: Date.now() + ROLE_CACHE_TTL };
  return roles;
}

export interface RoleMember {
  subUserId: string;
  email?: string;
  name?: string;
  active: boolean;
}

export interface ActingUser {
  /** Login email of the person actually signed in (the endpoint's `currentUser`). */
  email: string;
  /** Their sub-user _id, resolved via the directory — null when they ARE the parent/master. */
  subUserId: string | null;
  /** True when currentUser is the parent/master account itself. */
  isParent: boolean;
}

/**
 * Resolves WHO is actually signed in. The SSO exchange only ever reports the parent account's
 * userId (verified 2026-10-21), but `account/reportLogs2/getSubUsers` — callable WITH the
 * exchanged session token — returns `currentUser` (the login email), `parentUser`, and the full
 * sub-user email↔id directory. Identity comes from IOsense against the session token itself, so
 * it is not client-spoofable. Returns null if the endpoint is unavailable (caller falls back).
 */
export async function resolveActingUser(sessionToken: string): Promise<ActingUser | null> {
  for (const method of ['GET', 'PUT'] as const) {
    try {
      const res = await fetch(`${API_BASE}/account/reportLogs2/getSubUsers`, {
        method,
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
          'ngsw-bypass': 'true',
          origin: 'https://iosense.io',
          referer: 'https://iosense.io/',
        },
        body: method === 'PUT' ? '{}' : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 405) continue; // wrong method — try the next
      const json: any = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false || typeof json.currentUser !== 'string') {
        console.warn(`[identity] getSubUsers (${method}) unusable: ${res.status} ${json?.error ?? ''}`);
        continue;
      }
      const email = json.currentUser.trim().toLowerCase();
      const parentEmail = String(json.parentUser?.email ?? '').trim().toLowerCase();
      const match = (json.data ?? []).find((u: any) => String(u.email ?? '').trim().toLowerCase() === email);
      return {
        email: json.currentUser,
        subUserId: match ? String(match._id) : null,
        isParent: email !== '' && email === parentEmail,
      };
    } catch (err) {
      console.warn(`[identity] getSubUsers (${method}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return null;
}

/** Members of one role with name/email/status — paginated on totalCount. */
export async function fetchRoleMembers(roleId: string): Promise<RoleMember[]> {
  const members: RoleMember[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await put(`/account/subuser/child/${encodeURIComponent(roleId)}/${page}/${PAGE_SIZE}`, { search: {} });
    const batch: any[] = json?.data?.data ?? [];
    for (const m of batch) {
      const first = m?.userDetail?.personalDetails?.name?.first ?? '';
      const last = m?.userDetail?.personalDetails?.name?.last ?? '';
      members.push({
        subUserId: String(m._id ?? ''),
        email: m.email ? String(m.email) : undefined,
        name: `${first} ${last}`.trim() || undefined,
        active: m.isSubuserActive !== false && m.isSubuserSuspended !== true && (m.status === undefined || m.status === 'active'),
      });
    }
    const total = Number(json?.data?.totalCount ?? members.length);
    if (members.length >= total || batch.length === 0) break;
  }
  return members;
}
