import { CATEGORY_UNIT_ROSTER } from '../lib/plantCategory';

/**
 * Pure role → access derivation (no I/O; unit-testable).
 *
 * The IOsense org defines roles like "Refinery Read", "HGU Read", "Petchem PPU - HDPE",
 * "SRU Refineryoffsite edit", "All Read rights" — the units/plants are encoded in the
 * roleName. Per client ruling (2026-10-19): Edit-suffixed roles behave exactly like Read in
 * this app, and scoping is UNIT-level where units are named, plant-level for plain
 * "Refinery"/"Petchem", everything for "All".
 *
 * Admin ("defined user") rule: an authenticated user who appears in NO role's subUsers is a
 * main account → full access. ADMIN_USER_IDS env can force specific ids to admin.
 */

export interface RoleEntry {
  roleId: string;
  roleName: string;
  subUsers: string[];
}

export interface KnownSection {
  key: string; // envKey form, e.g. REFINERY_PPU
  name: string; // display name, e.g. "Refinery-PPU"
  category: string; // Refinery | Petchem | Unassigned
}

export type Access = { kind: 'admin' } | { kind: 'scoped'; sectionKeys: string[] };

/** Uppercase, alphanumerics only, runs of everything else → single space. */
function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
const squash = (s: string) => norm(s).replace(/ /g, '');

// Suffix/filler words that describe the ACCESS, not the scope.
const FILLER = new Set(['READ', 'EDIT', 'RIGHTS', 'RIGHT', 'VIEW', 'ACCESS', 'ONLY']);

interface Candidate {
  /** squashed normalized text this candidate matches on */
  squashed: string;
  sectionKeys: string[];
}

/**
 * Candidate match list for one org's sections: every section by name and key (longest first),
 * plant names expanding to the whole plant, "ALL" expanding to everything, plus the same
 * grouped aliases plantCategory.ts recognizes in device tags (PE SWING → both lines,
 * DFCU → all three).
 */
function buildCandidates(sections: KnownSection[]): Candidate[] {
  const all = sections.map((s) => s.key);
  const byCategory = (cat: string) => sections.filter((s) => s.category === cat).map((s) => s.key);
  const candidates: Candidate[] = [];
  for (const s of sections) {
    const texts = new Set([squash(s.name), squash(s.key)]);
    for (const t of texts) if (t) candidates.push({ squashed: t, sectionKeys: [s.key] });
  }
  const group = (text: string, keys: string[]) => {
    if (keys.length > 0) candidates.push({ squashed: squash(text), sectionKeys: keys });
  };
  group('PE SWING', sections.filter((s) => squash(s.key).startsWith('PESWING')).map((s) => s.key));
  group('DFCU', sections.filter((s) => squash(s.key).startsWith('DFCU')).map((s) => s.key));
  group('Refinery', byCategory('Refinery'));
  group('Petchem', byCategory('Petchem'));
  group('All', all);
  // Longest first so "REFINERYPPU" beats "REFINERY", "PETCHEMPPU" beats "PETCHEM", etc.
  return candidates.sort((a, b) => b.squashed.length - a.squashed.length);
}

/**
 * Resolves one roleName to the section keys it grants. Unknown tokens are ignored; a role
 * resolving to nothing (e.g. "test-subuser") grants nothing.
 */
export function resolveRoleSections(roleName: string, sections: KnownSection[]): string[] {
  const words = norm(roleName).split(' ').filter((w) => w && !FILLER.has(w));
  let remaining = words.join('');
  if (!remaining) return [];

  const matched = new Set<string>();
  for (const c of buildCandidates(sections)) {
    if (!remaining) break;
    const idx = remaining.indexOf(c.squashed);
    if (idx === -1) continue;
    for (const k of c.sectionKeys) matched.add(k);
    remaining = remaining.slice(0, idx) + remaining.slice(idx + c.squashed.length);
  }

  // Leftover fragments (e.g. "FCC" in "FCC PPU" — section is FCC-PC): prefix-match against
  // squashed section keys/names; ambiguity resolved toward the plant of sections already
  // matched in this same role, else skipped.
  if (remaining.length >= 3) {
    for (const word of words) {
      const sq = squash(word);
      if (!sq || sq.length < 3 || !remaining.includes(sq)) continue;
      // Recomputed per word so an earlier word's match (e.g. FCC → Refinery) disambiguates a
      // later one (PPU → Refinery-PPU, not Petchem-PPU).
      const matchedCategories = new Set(sections.filter((s) => matched.has(s.key)).map((s) => s.category));
      const hits = sections.filter(
        (s) => squash(s.key).startsWith(sq) || squash(s.name).startsWith(sq) || squash(s.name).includes(sq),
      );
      const pick = hits.length === 1 ? hits : hits.filter((h) => matchedCategories.has(h.category));
      if (pick.length === 1) {
        matched.add(pick[0].key);
        remaining = remaining.replace(sq, '');
      }
    }
  }
  return [...matched];
}

/** Parses ADMIN_USER_IDS (comma-separated) from env. */
function adminOverrideIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Role names whose members get FULL access (Generate + View + Schedule), exactly like the main
 * account — client decision 2026-10-21: the org's "All acess" role (sic — matching is
 * normalization-based, so the typo and any future respelling both work). Extend via env:
 * ADMIN_ROLE_NAMES="All acess,Report Admin".
 */
function adminRoleNames(): Set<string> {
  const names = (process.env.ADMIN_ROLE_NAMES ?? 'All acess,All access').split(',');
  return new Set(names.map((n) => norm(n)).filter(Boolean));
}

/** True when this roleName grants full admin access. */
export function isAdminRole(roleName: string): boolean {
  return adminRoleNames().has(norm(roleName));
}

export interface DeriveResult {
  access: Access | null;
  /** The role entries this user belongs to (for display/logging). */
  memberRoles: RoleEntry[];
}

export function deriveAccess(userId: string, roles: RoleEntry[], sections: KnownSection[]): DeriveResult {
  if (adminOverrideIds().has(userId)) return { access: { kind: 'admin' }, memberRoles: [] };

  const memberRoles = roles.filter((r) => r.subUsers.includes(userId));
  if (memberRoles.length === 0) {
    // Not a sub-user of any role → a main/"defined" account → full access.
    return { access: { kind: 'admin' }, memberRoles: [] };
  }

  // Members of an admin role (e.g. "All acess") get full access, same as the main account.
  if (memberRoles.some((r) => isAdminRole(r.roleName))) {
    return { access: { kind: 'admin' }, memberRoles };
  }

  // Every other department role — Read OR Edit suffix alike — grants READ access to the
  // sections named in the role (client decision 2026-10-21).
  const keys = new Set<string>();
  for (const role of memberRoles) {
    for (const k of resolveRoleSections(role.roleName, sections)) keys.add(k);
  }
  if (keys.size === 0) return { access: null, memberRoles }; // roles grant nothing here
  return { access: { kind: 'scoped', sectionKeys: [...keys] }, memberRoles };
}

/** Human description of an access level, e.g. "Admin" / "Read — HGU, CDU". */
export function describeAccess(access: Access, sections: KnownSection[]): string {
  if (access.kind === 'admin') return 'Admin';
  const names = access.sectionKeys
    .map((k) => sections.find((s) => s.key === k)?.name ?? k)
    .sort((a, b) => a.localeCompare(b));
  const byCat: Record<string, number> = {};
  for (const k of access.sectionKeys) {
    const cat = sections.find((s) => s.key === k)?.category ?? 'Unassigned';
    byCat[cat] = (byCat[cat] ?? 0) + 1;
  }
  // Whole-plant grants read better as the plant name than 11 unit names.
  const whole = Object.keys(CATEGORY_UNIT_ROSTER).filter(
    (cat) => byCat[cat] && byCat[cat] === sections.filter((s) => s.category === cat).length,
  );
  if (whole.length > 0 && whole.reduce((n, c) => n + (byCat[c] ?? 0), 0) === access.sectionKeys.length) {
    return `Read — ${whole.join(', ')}`;
  }
  return `Read — ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4} more` : ''}`;
}
