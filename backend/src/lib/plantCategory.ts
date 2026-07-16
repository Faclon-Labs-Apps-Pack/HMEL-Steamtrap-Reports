export const UNASSIGNED = 'Unassigned';

/**
 * Known unit -> plant category mapping, taken from the "Refinery" / "Petchem" sheets
 * in the reference management report (report templates/ManagementReportFormat...).
 * Extend this if new department/unit values show up in real data.
 */
const UNIT_TO_PLANT_CATEGORY: Record<string, string> = {
  'CPP-575': 'Refinery',
  'Refinery Offsite': 'Refinery',
  'Refinery Piperack': 'Refinery',
  DCU: 'Refinery',
  'CDU/VDU': 'Refinery',
  MSB: 'Refinery',
  HGU: 'Refinery',
  'DHDT-1': 'Refinery',
  VGO: 'Refinery',
  BS6: 'Refinery',
  SRU: 'Refinery',
  'FCC-PC': 'Refinery',
  DFCU: 'Petchem',
  'Petchem Offsite': 'Petchem',
  'Petchem Piperack': 'Petchem',
  'PE Swing': 'Petchem',
  HDPE: 'Petchem',
  'Petchem PPU': 'Petchem',
};

export function derivePlantCategory(unitName: string): string {
  const known = UNIT_TO_PLANT_CATEGORY[unitName];
  if (known) return known;

  const lower = unitName.toLowerCase();
  if (lower.includes('petchem')) return 'Petchem';
  if (lower.includes('refinery')) return 'Refinery';

  return UNASSIGNED;
}
