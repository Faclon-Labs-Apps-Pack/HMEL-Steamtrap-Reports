/**
 * Device tags encode department as a "department:<value>" string, e.g.
 * `["575-ST-HP-039 (...)", "type:ST2", "department:CPP-575", "sec: CPP-575"]`.
 * Confirmed against real getDeviceSpecificMetadata responses — colon spacing varies
 * ("department:CPP-575" vs "sec: CPP-575"), so this trims whatever follows the colon.
 */
export function extractDepartmentFromTags(tags: string[] | undefined): string | undefined {
  if (!tags) return undefined;

  for (const tag of tags) {
    const match = /^\s*department\s*:\s*(.+)$/i.exec(tag);
    if (match) {
      const value = match[1].trim();
      if (value) return value;
    }
  }

  return undefined;
}
