import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import { initAuth, AuthError } from '../auth/auth';
import { findDevicesByType, getLastDataPoints, ApiError } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getStatusChangeCountsByDevice } from '../services/statusChangeCounts';
import { SteamTrapStatusTable, type SteamTrapRow } from '../components/SteamTrapStatusTable';
import { UnitTrapStatusMatrix } from '../components/UnitTrapStatusMatrix';
import { CorrectiveActionMatrix } from '../components/CorrectiveActionMatrix';
import { GenerateExcelReportButton } from '../components/GenerateExcelReportButton';
import { generateManagementReportWorkbook } from '../reportGeneration/generateManagementReport';
import { generateDailyReportWorkbook } from '../reportGeneration/generateDailyReport';
import { generateMonthlyReportWorkbook } from '../reportGeneration/generateMonthlyReport';
import { segregateByUnit } from '../lib/segregateByUnit';
import { extractDepartmentFromTags } from '../lib/departmentTag';
import { getCurrentWeekRange, normalizeDateRange, toEpochMs, type DateRange } from '../lib/dateRange';
import { buildCorrectiveActionCountByDevice, segregateCorrectiveActionsAndChanges } from '../lib/segregateCorrectiveActions';
import type { CorrectiveActionMatrixData } from '../lib/segregateCorrectiveActions';
import type { Device, LastDataPoint } from '../types/device';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';

type LoadState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; devices: Device[]; lastDPs: LastDataPoint[] };

type CorrectiveActionState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; matrix: CorrectiveActionMatrixData };

export function SteamTrapStatusPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading', label: 'Loading devices…' });
  const [range, setRange] = useState<DateRange>(() => normalizeDateRange(getCurrentWeekRange()));
  const [caState, setCaState] = useState<CorrectiveActionState>({ phase: 'loading', label: 'Loading…' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await initAuth();

        const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);

        if (!cancelled) setState({ phase: 'loading', label: `Loading status for ${devices.length} devices…` });
        const lastDPs = await getLastDataPoints(
          devices.map((device) => ({ devID: device.devID, sensor: STATUS_SENSOR })),
        );

        if (!cancelled) setState({ phase: 'ready', devices, lastDPs });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong loading steam trap data.';
        setState({ phase: 'error', message });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.phase !== 'ready') return;
    let cancelled = false;

    async function loadCorrectiveActions() {
      if (state.phase !== 'ready') return;
      try {
        setCaState({ phase: 'loading', label: 'Loading corrective actions…' });
        const startMs = toEpochMs(range.start);
        const endMs = toEpochMs(range.end);
        console.log(
          `[SteamTrapStatusPage] Corrective action range: ${new Date(startMs).toISOString()} -> ${new Date(endMs).toISOString()} (${startMs} -> ${endMs})`,
        );

        const records = await getCorrectiveActions(
          state.devices.map((d) => d.devID),
          { startMs, endMs },
        );

        if (!cancelled) {
          setCaState({ phase: 'loading', label: `Counting status changes for ${state.devices.length} devices…` });
        }
        const statusChangeCountByDevID = await getStatusChangeCountsByDevice(state.devices, startMs, endMs);

        if (cancelled) return;
        const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(records);
        const matrix = segregateCorrectiveActionsAndChanges(
          state.devices,
          correctiveActionCountByDevID,
          statusChangeCountByDevID,
        );
        setCaState({ phase: 'ready', matrix });
      } catch (error) {
        if (cancelled) return;
        console.error('[SteamTrapStatusPage] Corrective actions load failed:', error);
        const message = error instanceof ApiError ? error.message : 'Something went wrong loading corrective actions.';
        setCaState({ phase: 'error', message });
      }
    }

    loadCorrectiveActions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range]);

  const rows: SteamTrapRow[] = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const statusByDevID = new Map(state.lastDPs.map((dp) => [dp.devID, dp.value]));
    return state.devices.map((device) => ({
      id: device.devID,
      device,
      status: statusByDevID.get(device.devID),
      department: extractDepartmentFromTags(device.tags),
    }));
  }, [state]);

  const matrix = useMemo(() => {
    if (state.phase !== 'ready') return null;
    return segregateByUnit(state.devices, state.lastDPs);
  }, [state]);

  return (
    <div className="global-p-06">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--spacing-03)',
        }}
      >
        <h1 className="HeadingSmallSemibold" style={{ margin: 0 }}>
          Steam Trap Status
        </h1>
        <div style={{ display: 'flex', gap: 'var(--spacing-03)' }}>
          <GenerateExcelReportButton
            idleLabel="Generate Management Report"
            generate={generateManagementReportWorkbook}
            filename={() => `Steam-Trap-Management-Report_${new Date().toISOString().slice(0, 10)}.xlsx`}
          />
          <GenerateExcelReportButton
            idleLabel="Generate Daily Report"
            generate={generateDailyReportWorkbook}
            filename={() => `Steam-Trap-Daily-Report_${new Date().toISOString().slice(0, 10)}.xlsx`}
          />
          <GenerateExcelReportButton
            idleLabel="Generate Monthly Report"
            generate={generateMonthlyReportWorkbook}
            filename={() => `Steam-Trap-Monthly-Report_${new Date().toISOString().slice(0, 10)}.xlsx`}
          />
        </div>
      </div>

      {state.phase === 'ready' && (
        <p className="BodyMediumRegular" style={{ marginBottom: 'var(--spacing-05)' }}>
          {rows.length} {rows.length === 1 ? 'device' : 'devices'}
        </p>
      )}

      {state.phase === 'loading' && <Spinner label={state.label} />}

      {state.phase === 'error' && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="Couldn't load steam trap data"
          description={state.message}
        />
      )}

      {state.phase === 'ready' && matrix && (
        <>
          <h2 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-07) 0 var(--spacing-04)' }}>
            Unit vs Trap Status
          </h2>
          <UnitTrapStatusMatrix matrix={matrix} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: 'var(--spacing-07) 0 var(--spacing-04)',
            }}
          >
            <h2 className="HeadingXSmallSemibold" style={{ margin: 0 }}>
              Corrective Actions &amp; Status Changes
            </h2>
            <DatePicker
              mode="range"
              rangeValue={range}
              onRangeChange={(value) => value && setRange(normalizeDateRange(value))}
              label="Date range"
            />
          </div>

          {caState.phase === 'loading' && <Spinner label={caState.label} />}
          {caState.phase === 'error' && (
            <EmptyState
              illustration={<NoDataOneIllustration size={90} />}
              title="Couldn't load corrective actions"
              description={caState.message}
            />
          )}
          {caState.phase === 'ready' && <CorrectiveActionMatrix matrix={caState.matrix} />}

          <h2 className="HeadingXSmallSemibold" style={{ margin: 'var(--spacing-07) 0 var(--spacing-04)' }}>
            Device Status
          </h2>
          <SteamTrapStatusTable rows={rows} />
        </>
      )}
    </div>
  );
}
