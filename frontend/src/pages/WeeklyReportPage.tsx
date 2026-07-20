import { useEffect, useState } from 'react';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { initAuth, AuthError } from '../auth/auth';
import { ApiError } from '../services/iosenseApi';
import { collectManagementReportData, type ManagementReportData } from '../reportGeneration/collectManagementReportData';
import { filterUnitStatusMatrixByCategory, filterCorrectiveActionMatrixByCategory } from '../lib/filterMatrixByCategory';
import { UnitTrapStatusMatrix } from '../components/UnitTrapStatusMatrix';
import { CorrectiveActionMatrix } from '../components/CorrectiveActionMatrix';
import { DeviceDetailTable } from '../components/DeviceDetailTable';
import { CorrectiveActionLogTable } from '../components/CorrectiveActionLogTable';
import type { DeviceDetailRow } from '../lib/buildDeviceDetailRows';
import type { SteamKpiTotals } from '../reportGeneration/buildOverviewSheet';

const COST_OF_STEAM_PER_TON = 2473; // hardcoded, matches the .xlsx report

type LoadState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: ManagementReportData };

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function KpiRow({ kpis }: { kpis: SteamKpiTotals }) {
  const tiles: [string, string][] = [
    ['Cost of Steam (Rs/Ton)', String(COST_OF_STEAM_PER_TON)],
    ['Steam Loss (MT)', kpis.steamLossMT.toFixed(2)],
    ['Loss (INR)', kpis.lossINR.toFixed(2)],
    ['Savings (MT)', kpis.steamSavingMT.toFixed(2)],
    ['Savings (INR)', kpis.savingsINR.toFixed(2)],
  ];
  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-05)', flexWrap: 'wrap', marginBottom: 'var(--spacing-05)' }}>
      {tiles.map(([label, value]) => (
        <div
          key={label}
          style={{
            border: 'var(--fds-border-default)',
            borderRadius: 'var(--radius-04)',
            padding: 'var(--spacing-04)',
            minWidth: '160px',
          }}
        >
          <div className="BodySmallRegular" style={{ color: 'var(--text-default-secondary)' }}>
            {label}
          </div>
          <div className="HeadingXSmallSemibold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function CategorySection({
  category,
  data,
}: {
  category: 'Refinery' | 'Petchem';
  data: ManagementReportData;
}) {
  const rows: DeviceDetailRow[] = category === 'Refinery' ? data.refineryRows : data.petchemRows;
  const kpis = category === 'Refinery' ? data.refineryKpis : data.petchemKpis;

  return (
    <div style={{ marginBottom: 'var(--spacing-08)' }}>
      <h2 className="HeadingSmallSemibold" style={{ margin: '0 0 var(--spacing-04)' }}>
        {category}
      </h2>

      <KpiRow kpis={kpis} />

      <h3 className="HeadingXSmallSemibold" style={{ margin: '0 0 var(--spacing-04)' }}>
        Unit vs Trap Status
      </h3>
      <UnitTrapStatusMatrix matrix={filterUnitStatusMatrixByCategory(data.matrix, category)} />

      <h3 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-06) 0 var(--spacing-04)' }}>
        Corrective Action &amp; Status Changes
      </h3>
      <CorrectiveActionMatrix matrix={filterCorrectiveActionMatrixByCategory(data.correctiveActionMatrix, category)} />

      <h3 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-06) 0 var(--spacing-04)' }}>
        Device Detail
      </h3>
      <DeviceDetailTable rows={rows} />
    </div>
  );
}

/**
 * On-screen equivalent of the Management Report .xlsx — same data, same last-fully-completed-week
 * window, organized the same way (per-category overview + detail, then a combined corrective
 * action log), just rendered as tables instead of downloaded as a spreadsheet. The "Generate
 * Management Report" button (SteamTrapStatusPage) still produces the actual .xlsx — this tab is
 * a read-only preview of the same data using `collectManagementReportData`, the shared data
 * source both consume.
 */
export function WeeklyReportPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading', label: 'Loading devices…' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await initAuth();
        const data = await collectManagementReportData((p) => {
          if (!cancelled) setState({ phase: 'loading', label: p.label });
        });
        if (cancelled) return;
        setState({ phase: 'ready', data });
      } catch (error) {
        if (cancelled) return;
        console.error('[WeeklyReportPage] load failed:', error);
        const message =
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong loading the weekly report.';
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
      <h1 className="HeadingSmallSemibold" style={{ margin: 0 }}>
        Weekly Report
      </h1>

      {state.phase === 'ready' && (
        <p className="BodyMediumRegular" style={{ margin: 'var(--spacing-02) 0 var(--spacing-06)' }}>
          {formatDateTime(state.data.range.start)} &ndash; {formatDateTime(state.data.range.end)} (last fully-completed
          week) &middot; generated {formatDateTime(state.data.generatedAt)}
        </p>
      )}

      {state.phase === 'loading' && <Spinner label={state.label} />}

      {state.phase === 'error' && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="Couldn't load the weekly report"
          description={state.message}
        />
      )}

      {state.phase === 'ready' && (
        <>
          <CategorySection category="Refinery" data={state.data} />
          <CategorySection category="Petchem" data={state.data} />

          <h2 className="HeadingSmallSemibold" style={{ margin: '0 0 var(--spacing-04)' }}>
            Corrective Action Log
          </h2>
          <CorrectiveActionLogTable rows={state.data.logRows} />
        </>
      )}
    </div>
  );
}
