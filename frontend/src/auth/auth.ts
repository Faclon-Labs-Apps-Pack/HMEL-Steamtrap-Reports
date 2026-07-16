const SSO_EXCHANGE_URL = 'https://connector.iosense.io/api/retrieve-sso-token';

const TOKEN_KEY = 'bearer_token';
const ORG_KEY = 'organisation';
const USER_KEY = 'userId';

interface SSOExchangeResponse {
  success: boolean;
  token?: string;
  organisation?: string;
  userId?: string;
  errors?: string[];
}

export class AuthError extends Error {}

async function exchangeSSOToken(ssoToken: string): Promise<string> {
  const response = await fetch(`${SSO_EXCHANGE_URL}/${ssoToken}`, {
    method: 'GET',
    headers: {
      organisation: 'https://iosense.io',
      'ngsw-bypass': 'true',
      'Content-Type': 'application/json',
    },
  });

  const data: SSOExchangeResponse = await response.json();

  if (!response.ok || !data.success || !data.token) {
    throw new AuthError(
      data.errors?.join(', ') || 'SSO token exchange failed. Please get a fresh link from the IOsense portal.',
    );
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
export async function initAuth(): Promise<string> {
  const url = new URL(window.location.href);
  const ssoToken = url.searchParams.get('token');

  if (ssoToken) {
    const jwt = await exchangeSSOToken(ssoToken);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    return jwt;
  }

  const cached = getStoredToken();
  if (!cached) {
    throw new AuthError('No SSO token in URL and no cached session. Open this app from the IOsense portal.');
  }
  return cached;
}
