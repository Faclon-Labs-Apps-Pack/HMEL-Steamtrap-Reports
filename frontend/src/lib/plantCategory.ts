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

/** Uppercase, alphanumerics only (runs of spaces/hyphens/slashes/parentheses → a single space). */
function normalizeUnitRaw(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/**
 * Live device department tags sometimes use a shorter/alternate spelling than the canonical roster
 * name — confirmed with the client that these are the SAME unit. Map the normalized live spelling to
 * the roster's normalized form so those devices land in the right Unit Name row AND plant category
 * (otherwise they fall through to "Unassigned" and are dropped from the weekly report):
 *   • tag "CDU"   → roster "CDU/VDU" (Refinery)   — the plain "CDU" wouldn't match "CDU VDU"
 *   • tag "DHDT1" → roster "DHDT-1"  (Refinery)   — "DHDT1" wouldn't match "DHDT 1"
 */
const NORMALIZED_UNIT_ALIASES: Record<string, string> = {
  [normalizeUnitRaw('CDU')]: normalizeUnitRaw('CDU/VDU'),
  [normalizeUnitRaw('DHDT1')]: normalizeUnitRaw('DHDT-1'),
};

/** Normalize a unit/tag name (see normalizeUnitRaw) and fold known live-spelling aliases onto the
 *  canonical roster name — so tag spellings and canonical names compare equal. */
export function normalizeUnit(name: string): string {
  const n = normalizeUnitRaw(name);
  return NORMALIZED_UNIT_ALIASES[n] ?? n;
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
