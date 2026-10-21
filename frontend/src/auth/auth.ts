const TOKEN_KEY = 'bearer_token';
const ORG_KEY = 'organisation';
const USER_KEY = 'userId';

interface SSOExchangeResponse {
  token?: string;
  organisation?: string;
  userId?: string;
  error?: string;
}

export class AuthError extends Error {}

/**
 * The one-time SSO token is exchanged THROUGH OUR BACKEND (not IOsense directly): the backend
 * needs to witness IOsense's verified token↔userId pairing to enforce roles server-side — a
 * client-claimed userId is never trusted (see backend/src/api/authMiddleware.ts).
 */
async function exchangeSSOToken(ssoToken: string): Promise<string> {
  const response = await fetch('/api/session/sso-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssoToken }),
  });

  const data: SSOExchangeResponse = await response.json().catch(() => ({}));

  if (!response.ok || !data.token) {
    throw new AuthError(data.error || 'SSO token exchange failed. Please get a fresh link from the IOsense portal.');
  }

  localStorage.setItem(TOKEN_KEY, data.token);
  if (data.organisation) localStorage.setItem(ORG_KEY, data.organisation);
  if (data.userId) localStorage.setItem(USER_KEY, data.userId);

  return data.token;
}

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function getOrganisation(): string {
  return localStorage.getItem(ORG_KEY) ?? '';
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Resolves the JWT for the session: exchanges a one-time `?token=` SSO param
 * on first load (then strips it from the URL), otherwise falls back to
 * whatever is already cached in localStorage.
 */
const SSO_PARAM_NAMES = ['token', 'sso_token', 'ssoToken', 'ssotoken', 'access_token'];

/** Finds the one-time SSO token wherever the portal put it: any known param name, in either the
 *  query string or the hash fragment (some portal launchers append after the `#`). */
function extractSsoToken(url: URL): { value: string; strip: () => void } | null {
  for (const name of SSO_PARAM_NAMES) {
    const v = url.searchParams.get(name);
    if (v) {
      return {
        value: v,
        strip: () => {
          url.searchParams.delete(name);
          window.history.replaceState({}, '', url.toString());
        },
      };
    }
  }
  // Hash variants: "#/path?token=…" or "#token=…"
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const queryInHash = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  const hashParams = new URLSearchParams(queryInHash);
  for (const name of SSO_PARAM_NAMES) {
    const v = hashParams.get(name);
    if (v) {
      return {
        value: v,
        strip: () => {
          hashParams.delete(name);
          const prefix = hash.includes('?') ? hash.slice(0, hash.indexOf('?')) : '';
          const rest = hashParams.toString();
          url.hash = prefix || rest ? `${prefix}${rest ? `?${rest}` : ''}` : '';
          window.history.replaceState({}, '', url.toString());
        },
      };
    }
  }
  return null;
}

export async function initAuth(): Promise<string> {
  const url = new URL(window.location.href);
  const sso = extractSsoToken(url);

  if (sso) {
    const jwt = await exchangeSSOToken(sso.value);
    sso.strip();
    return jwt;
  }

  const cached = getStoredToken();
  if (!cached) {
    // Name the params we DID receive — makes "the portal isn't passing a token" instantly
    // visible in the error card instead of needing DevTools.
    const seen = [...url.searchParams.keys()];
    throw new AuthError(
      `No SSO token in the URL and no cached session. Open this app from the IOsense portal.${seen.length ? ` (URL params received: ${seen.join(', ')})` : ' (no URL parameters received)'}`,
    );
  }
  return cached;
}
