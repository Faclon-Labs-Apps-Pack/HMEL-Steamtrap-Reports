import { getDeviceMetadata } from './iosenseApi';
import { runWithConcurrencyLimit } from '../lib/concurrency';
import type { Device } from '../types/device';
import type { DeviceProperty } from './iosenseApi';

export interface SteamTrapProperties {
  inletPressure?: string;
  outletPressure?: string;
  baseLineInletTemperature?: string;
  baseLineOutletTemperature?: string;
  /** "Steam Leak" property, e.g. "150 Kg/hr" — used as the report's Leak Rate. */
  leakRate?: string;
  costOfSteam?: string | number;
  /** "Trap Location" property — a real per-device field, distinct from and more accurate than devName for a Location column. */
  trapLocation?: string;
  /** "Type Of Steam" property, e.g. "HP" / "MP" / "LP" — the steam grade the trap is on. */
  steamType?: string;
}

function findProp(properties: DeviceProperty[], name: string): string | number | undefined {
  return properties.find((p) => p.propertyName.toLowerCase() === name.toLowerCase())?.propertyValue;
}

function toSteamTrapProperties(properties: DeviceProperty[]): SteamTrapProperties {
  return {
    inletPressure: findProp(properties, 'inletPressure') as string | undefined,
    outletPressure: findProp(properties, 'outletPressure') as string | undefined,
    baseLineInletTemperature: findProp(properties, 'baseLineInletTemperature') as string | undefined,
    baseLineOutletTemperature: findProp(properties, 'baseLineOutletTemperature') as string | undefined,
    leakRate: findProp(properties, 'Steam Leak') as string | undefined,
    costOfSteam: findProp(properties, 'costOfSteam'),
    trapLocation: findProp(properties, 'Trap Location') as string | undefined,
    steamType: findProp(properties, 'Type Of Steam') as string | undefined,
  };
}

/**
 * Fetches per-device metadata properties for ALL given devices, concurrency-limited (10 in
 * flight) since there's no bulk properties endpoint — see `getDeviceMetadata`.
 */
export async function getDevicePropertiesByDevice(devices: Device[]): Promise<Map<string, SteamTrapProperties>> {
  const results = await runWithConcurrencyLimit(devices, 10, async (device) => {
    const properties = await getDeviceMetadata(device.devID);
    return [device.devID, toSteamTrapProperties(properties)] as const;
  });

  return new Map(results);
}
