import { initAuth, AuthError } from './auth';
import { fetchMe, type Me } from '../services/adminApi';

export type { Me };
export { AuthError };

/**
 * Boots the signed-in session: resolve the IOsense token (one-time ?token= SSO exchange via our
 * backend, else the cached token), then ask OUR backend who this user is and what they may see
 * (/api/me — roles are derived and enforced server-side; the frontend never talks to the
 * IOsense role endpoints itself).
 *
 * Throws AuthError (not signed in / session expired) or NoAccessError (valid account, no
 * report roles) — the AuthGate maps each to its own screen.
 */
export async function bootstrapSession(): Promise<Me> {
  try {
    await initAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      // No token at all. Normally hopeless — but when the backend runs with the explicit dev
      // bypass (ADMIN_API_AUTH=off), /api/me answers without one. Try it; if the backend
      // enforces auth we get the 401 and rethrow the original, clearer error.
      try {
        return await fetchMe();
      } catch {
        throw err;
      }
    }
    throw err;
  }
  return fetchMe();
}
