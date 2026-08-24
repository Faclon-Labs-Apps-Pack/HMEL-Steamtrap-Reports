export const UNASSIGNED = 'Unassigned';

/**
 * Canonical roster of units per plant category, in the exact order the client wants them listed
 * in the weekly report (confirmed 2026-08-13). Every unit here gets a row in that category's
 * weekly report even if it currently has no devices/data (a blank row), matching the client's
 * reference workbook. Live device "department" tags are matched to these by `normalizeUnit`, so
 * tag spellings like "PE-SWING-LINE-1" / "Refinery-Offsite" / "DFCU (AU)" line up with the
 * canonical names below regardless of spaces, hyphens, slashes, or parentheses.
 */
export const CATEGORY_UNIT_ROSTER: Record<string, string[]> = {
  Refinery: [
    'MSB',
    'HGU',
    'DHDT-1',
    'VGO',
    'BS6',
    'SRU',
    'CPP-575',
    'Refinery Offsite',
    'FCC-PC',
    'CDU/VDU',
    'DCU',
  ],
  Petchem: [
    'HDPE',
    'Petchem PPU',
    'DFCU (AU)',
    'DFCU (COLD)',
    'DFCU (HOT)',
    'PE Swing Line-1',
    'PE Swing Line-2',
    'Petchem Offsite',
  ],
};

/** Uppercase, alphanumerics only (runs of spaces/hyphens/slashes/parentheses → a single space) — so tag spellings and canonical names compare equal. */
export function normalizeUnit(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

// Normalized unit-name -> plant category, built from the roster above (plus a few legacy
// spellings kept for safety). Extend the roster, not this.
const UNIT_TO_PLANT_CATEGORY = new Map<string, string>([
  ...Object.entries(CATEGORY_UNIT_ROSTER).flatMap(([category, units]) =>
    units.map((u) => [normalizeUnit(u), category] as [string, string]),
  ),
  [normalizeUnit('Refinery Piperack'), 'Refinery'],
  [normalizeUnit('Petchem Piperack'), 'Petchem'],
  [normalizeUnit('DFCU'), 'Petchem'],
  [normalizeUnit('PE Swing'), 'Petchem'],
]);

export function derivePlantCategory(unitName: string): string {
  const known = UNIT_TO_PLANT_CATEGORY.get(normalizeUnit(unitName));
  if (known) return known;

  const lower = unitName.toLowerCase();
  if (lower.includes('petchem')) return 'Petchem';
  if (lower.includes('refinery')) return 'Refinery';

  return UNASSIGNED;
}
