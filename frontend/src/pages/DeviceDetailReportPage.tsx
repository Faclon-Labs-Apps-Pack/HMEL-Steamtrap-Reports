import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@faclon-labs/design-sdk/Spinner';
import { EmptyState, NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { initAuth, AuthError } from '../auth/auth';
import { findDevicesByType, getLastDataPoints, ApiError } from '../services/iosenseApi';
import { getCorrectiveActions } from '../services/correctiveActionApi';
import { getFeedbackCountsByDevice } from '../services/feedbackApi';
import { getTimeSeriesStatsByDevice } from '../services/deviceTimeSeriesStats';
import { getDevicePropertiesByDevice } from '../services/devicePropertiesApi';
import { getSteamLossByDevice, getSteamSavingByDevice } from '../services/steamConsumptionApi';
import { buildCorrectiveActionCountByDevice } from '../lib/segregateCorrectiveActions';
import { buildDeviceDetailRows, type DeviceDetailRow } from '../lib/buildDeviceDetailRows';
import { getCurrentWeekRange, normalizeDateRange, toEpochMs, type DateRange } from '../lib/dateRange';
import { DeviceDetailTable } from '../components/DeviceDetailTable';
import type { LastDataPoint } from '../types/device';

const STEAM_TRAP_DEVICE_TYPE = 'steam trap';
const STATUS_SENSOR = 'S1';
const ALL_CATEGORIES = 'All';

type LoadState =
  | { phase: 'loading'; label: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rows: DeviceDetailRow[] };

export function DeviceDetailReportPage() {
  const [range, setRange] = useState<DateRange>(() => normalizeDateRange(getCurrentWeekRange()));
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [isCategoryOpen, setCategoryOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ phase: 'loading', label: 'Loading devices…' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setState({ phase: 'loading', label: 'Loading devices…' });
        await initAuth();

        const devices = await findDevicesByType(STEAM_TRAP_DEVICE_TYPE);
        const startMs = toEpochMs(range.start);
        const endMs = toEpochMs(range.end);
        const durationHours = (endMs - startMs) / (1000 * 60 * 60);

        if (!cancelled) setState({ phase: 'loading', label: `Loading current status for ${devices.length} devices…` });
        const lastDPs: LastDataPoint[] = await getLastDataPoints(
          devices.map((device) => ({ devID: device.devID, sensor: STATUS_SENSOR })),
        );

        if (!cancelled) setState({ phase: 'loading', label: `Loading corrective actions…` });
        const records = await getCorrectiveActions(
          devices.map((d) => d.devID),
          { startMs, endMs },
        );
        const correctiveActionCountByDevID = buildCorrectiveActionCountByDevice(records);

        if (!cancelled) {
          setState({ phase: 'loading', label: `Loading feedback counts for ${devices.length} devices…` });
        }
        const feedbackCountByDevID = await getFeedbackCountsByDevice(devices);

        if (!cancelled) {
          setState({ phase: 'loading', label: `Analyzing S1 history for ${devices.length} devices…` });
        }
        const timeSeriesStatsByDevID = await getTimeSeriesStatsByDevice(devices, startMs, endMs);

        if (!cancelled) {
          setState({ phase: 'loading', label: `Loading device properties for ${devices.length} devices…` });
        }
        const propertiesByDevID = await getDevicePropertiesByDevice(devices);

        if (!cancelled) {
          setState({ phase: 'loading', label: `Loading steam loss for ${devices.length} devices…` });
        }
        const steamLossByDevID = await getSteamLossByDevice(devices, startMs, endMs);

        if (!cancelled) {
          setState({ phase: 'loading', label: `Loading steam saving for ${devices.length} devices…` });
        }
        const steamSavingByDevID = await getSteamSavingByDevice(devices, startMs, endMs);

        if (cancelled) return;
        const rows = buildDeviceDetailRows(
          devices,
          lastDPs,
          timeSeriesStatsByDevID,
          correctiveActionCountByDevID,
          feedbackCountByDevID,
          propertiesByDevID,
          steamLossByDevID,
          steamSavingByDevID,
          durationHours,
        );
        setState({ phase: 'ready', rows });
      } catch (error) {
        if (cancelled) return;
        console.error('[DeviceDetailReportPage] load failed:', error);
        const message =
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong loading the device detail report.';
        setState({ phase: 'error', message });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const categoryOptions = useMemo(() => {
    if (state.phase !== 'ready') return [ALL_CATEGORIES];
    const set = new Set(state.rows.map((r) => r.plantCategory));
    return [ALL_CATEGORIES, ...[...set].sort()];
  }, [state]);

  const filteredRows = useMemo(() => {
    if (state.phase !== 'ready') return [];
    if (category === ALL_CATEGORIES) return state.rows;
    return state.rows.filter((r) => r.plantCategory === category);
  }, [state, category]);

  return (
    <div className="global-p-06">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--spacing-05)',
        }}
      >
        <h1 className="HeadingSmallSemibold" style={{ margin: 0 }}>
          Device Detail Report
        </h1>
        <div style={{ display: 'flex', gap: 'var(--spacing-04)' }}>
          <SelectInput
            label="Category"
            value={category}
            isOpen={isCategoryOpen}
            onClick={() => setCategoryOpen((o) => !o)}
          >
            {isCategoryOpen && (
              <DropdownMenu>
                {categoryOptions.map((option) => (
                  <ActionListItem
                    key={option}
                    title={option}
                    isSelected={category === option}
                    onClick={() => {
                      setCategory(option);
                      setCategoryOpen(false);
                    }}
                  />
                ))}
              </DropdownMenu>
            )}
          </SelectInput>
          <DatePicker
            mode="range"
            rangeValue={range}
            onRangeChange={(value) => value && setRange(normalizeDateRange(value))}
            label="Date range"
          />
        </div>
      </div>

      {state.phase === 'loading' && <Spinner label={state.label} />}

      {state.phase === 'error' && (
        <EmptyState
          illustration={<NoDataOneIllustration size={90} />}
          title="Couldn't load the device detail report"
          description={state.message}
        />
      )}

      {state.phase === 'ready' && <DeviceDetailTable rows={filteredRows} />}
    </div>
  );
}
