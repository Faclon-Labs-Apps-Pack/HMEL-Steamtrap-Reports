import { useEffect, useState } from 'react';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { initAuth, AuthError } from '../auth/auth';
import { findDevicesByType, ApiError } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { buildCorrectiveActionLogRows, type CorrectiveActionLogRow } from '../lib/buildCorrectiveActionLogRows';
import { CorrectiveActionLogTable } from '../components/CorrectiveActionLogTable';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';

type LoadState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rows: CorrectiveActionLogRow[] };

export function CorrectiveActionLogPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading', label: 'Loading devices…' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await initAuth();

        const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

        if (!cancelled) setState({ phase: 'loading', label: 'Loading corrective action log…' });
        const records = await getCorrectiveActions(devices.map((d) => d.devID));

        if (cancelled) return;
        setState({ phase: 'ready', rows: buildCorrectiveActionLogRows(records, devices) });
      } catch (error) {
        if (cancelled) return;
        console.error('[CorrectiveActionLogPage] load failed:', error);
        const message =
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong loading the corrective action log.';
        setState({ phase: 'error', message });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="global-p-06">
      <h1 className="HeadingSmallSemibold" style={{ marginBottom: 'var(--spacing-05)' }}>
        Corrective Action Log
      </h1>

      {state.phase === 'loading' && <Spinner label={state.label} />}

      {state.phase === 'error' && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="Couldn't load the corrective action log"
          description={state.message}
        />
      )}

      {state.phase === 'ready' && <CorrectiveActionLogTable rows={state.rows} />}
    </div>
  );
}
