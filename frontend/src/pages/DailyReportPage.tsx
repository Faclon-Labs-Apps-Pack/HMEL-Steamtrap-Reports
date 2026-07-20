import { useEffect, useState } from 'react';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { initAuth, AuthError } from '../auth/auth';
import { ApiError } from '../services/iosenseApi';
import { collectDailyReportData, DAILY_REPORT_COST_OF_STEAM, type DailyReportData } from '../reportGeneration/collectDailyReportData';
import { STATUS_COLUMNS } from '../lib/statusClassification';
import { DailyAnalysisTable } from '../components/DailyAnalysisTable';
import { DailyLiveStatusTable } from '../components/DailyLiveStatusTable';

type LoadState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: DailyReportData };

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
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
  );
}

/**
 * On-screen equivalent of the Daily Report .xlsx (Summary + Analysis + Live Status sheets),
 * windowed to today, no plant-category segregation — matches `generateDailyReportWorkbook`'s
 * spec exactly, since both consume `collectDailyReportData`.
 */
export function DailyReportPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading', label: 'Loading devices…' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await initAuth();
        const data = await collectDailyReportData((p) => {
          if (!cancelled) setState({ phase: 'loading', label: p.label });
        });
        if (cancelled) return;
        setState({ phase: 'ready', data });
      } catch (error) {
        if (cancelled) return;
        console.error('[DailyReportPage] load failed:', error);
        const message =
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong loading the daily report.';
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
        Daily Report
      </h1>

      {state.phase === 'ready' && (
        <p className="BodyMediumRegular" style={{ margin: 'var(--spacing-02) 0 var(--spacing-06)' }}>
          {formatDateTime(state.data.range.start)} &ndash; {formatDateTime(state.data.range.end)} (today) &middot;
          generated {formatDateTime(state.data.generatedAt)} &middot; {state.data.devices.length} devices
        </p>
      )}

      {state.phase === 'loading' && <Spinner label={state.label} />}

      {state.phase === 'error' && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="Couldn't load the daily report"
          description={state.message}
        />
      )}

      {state.phase === 'ready' && (
        <>
          <h2 className="HeadingXSmallSemibold" style={{ margin: '0 0 var(--spacing-04)' }}>
            Status Breakdown
          </h2>
          <div style={{ display: 'flex', gap: 'var(--spacing-05)', flexWrap: 'wrap', marginBottom: 'var(--spacing-06)' }}>
            {STATUS_COLUMNS.map((col) => {
              const count = state.data.statusCounts[col];
              const pct = state.data.devices.length > 0 ? ((count / state.data.devices.length) * 100).toFixed(1) : '0.0';
              return <StatTile key={col} label={col} value={`${count} (${pct}%)`} />;
            })}
          </div>

          <h2 className="HeadingXSmallSemibold" style={{ margin: '0 0 var(--spacing-04)' }}>
            Summary
          </h2>
          <div style={{ display: 'flex', gap: 'var(--spacing-05)', flexWrap: 'wrap', marginBottom: 'var(--spacing-06)' }}>
            <StatTile label="Number of Feedback" value={String(state.data.feedbackTotal)} />
            <StatTile label="Corrective Actions" value={String(state.data.correctiveActionTotal)} />
            <StatTile label="Status Changes" value={String(state.data.statusChangeTotal)} />
            <StatTile label="Cost of Steam (Rs/Ton)" value={String(DAILY_REPORT_COST_OF_STEAM)} />
            <StatTile label="Loss (MT)" value={state.data.steamLossTotal.toFixed(2)} />
            <StatTile label="Loss (INR)" value={(state.data.steamLossTotal * DAILY_REPORT_COST_OF_STEAM).toFixed(2)} />
            <StatTile label="Savings (MT)" value={state.data.steamSavingTotal.toFixed(2)} />
            <StatTile
              label="Savings (INR)"
              value={(state.data.steamSavingTotal * DAILY_REPORT_COST_OF_STEAM).toFixed(2)}
            />
          </div>

          <h2 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-06) 0 var(--spacing-04)' }}>
            Analysis
          </h2>
          <DailyAnalysisTable rows={state.data.analysisRows} />

          <h2 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-06) 0 var(--spacing-04)' }}>
            Live Status
          </h2>
          <DailyLiveStatusTable rows={state.data.liveStatusRows} />
        </>
      )}
    </div>
  );
}
