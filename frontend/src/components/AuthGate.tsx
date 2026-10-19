import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@faclon-labs/design-sdk/Button';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { Badge } from '@faclon-labs/design-sdk';
import { bootstrapSession, AuthError, type Me } from '../auth/session';
import { clearAuth } from '../auth/auth';
import { NoAccessError } from '../services/adminApi';

/**
 * Gates the whole app on a valid IOsense session (see auth/session.ts):
 *   loading → ready (renders children with the session) | signed-out | no-access.
 * Also flips to signed-out when any API call reports 401 mid-session (the 'auth:expired'
 * window event dispatched by services/adminApi.ts).
 */

type GateState =
  | { phase: 'loading' }
  | { phase: 'ready'; me: Me }
  | { phase: 'signed-out'; message: string }
  | { phase: 'no-access'; message: string };

function logout(): void {
  clearAuth();
  window.location.reload();
}

/** Full-screen message card for the signed-out / no-access states. */
function GateScreen({ title, message, showLogout }: { title: string; message: string; showLogout?: boolean }) {
  return (
    <div className="ui-main" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div className="ui-panel ui-fade-in" style={{ maxWidth: 460, padding: '32px 36px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: "'Outfit', 'Inter', sans-serif", fontSize: 21, fontWeight: 700, margin: '0 0 8px' }}>{title}</h1>
        <p className="BodySmallRegular ui-muted" style={{ margin: '0 0 20px' }}>{message}</p>
        {showLogout ? (
          <Button variant="Secondary" label="Log out" onClick={logout} />
        ) : (
          <p className="BodySmallRegular ui-muted-3" style={{ margin: 0 }}>
            Open the Steam Trap Reports link from your IOsense launchpad to sign in.
          </p>
        )}
      </div>
    </div>
  );
}

/** Compact who-am-I strip: identity, role chip, logout. */
export function SessionBar({ me }: { me: Me }) {
  return (
    <div className="ui-session-bar">
      <span className="BodySmallRegular ui-muted">{me.name || me.email || me.userId}</span>
      <Badge size="Small" color={me.access.kind === 'admin' ? 'Information' : 'Neutral'} label={me.accessLabel} />
      <span style={{ flex: 1 }} />
      <Button variant="Gray" size="XSmall" label="Log out" onClick={logout} />
    </div>
  );
}

export function AuthGate({ children }: { children: (me: Me) => ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    bootstrapSession()
      .then((me) => !cancelled && setState({ phase: 'ready', me }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NoAccessError) {
          setState({ phase: 'no-access', message: err.message });
        } else if (err instanceof AuthError) {
          setState({ phase: 'signed-out', message: err.message });
        } else {
          setState({ phase: 'signed-out', message: err instanceof Error ? err.message : 'Could not verify your session.' });
        }
      });

    const onExpired = (e: Event) => {
      clearAuth();
      setState({
        phase: 'signed-out',
        message: (e as CustomEvent).detail || 'Your session expired — open the app again from the IOsense portal.',
      });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => {
      cancelled = true;
      window.removeEventListener('auth:expired', onExpired);
    };
  }, []);

  if (state.phase === 'loading') {
    return (
      <div className="ui-main" style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spinner label="Signing you in…" />
      </div>
    );
  }
  if (state.phase === 'signed-out') {
    return <GateScreen title="Sign in required" message={state.message} />;
  }
  if (state.phase === 'no-access') {
    return <GateScreen title="No report access" message={state.message} showLogout />;
  }
  return <>{children(state.me)}</>;
}
