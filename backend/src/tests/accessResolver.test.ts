/**
 * Sanity check: resolveRoleSections over every real roleName observed in the org's
 * fetchRole response (2026-10-19). Run: npx tsx src/tests/accessResolver.test.ts
 */
import { resolveRoleSections, deriveAccess, type KnownSection } from '../api/access';

const S = (key: string, name: string, category: string): KnownSection => ({ key, name, category });
const SECTIONS: KnownSection[] = [
  S('BS6', 'BS6', 'Refinery'),
  S('CDU', 'CDU', 'Refinery'),
  S('CPP_575', 'CPP-575', 'Refinery'),
  S('DCU', 'DCU', 'Refinery'),
  S('DHDT1', 'DHDT1', 'Refinery'),
  S('FCC_PC', 'FCC-PC', 'Refinery'),
  S('HGU', 'HGU', 'Refinery'),
  S('MSB', 'MSB', 'Refinery'),
  S('REFINERY_OFFSITE', 'Refinery-Offsite', 'Refinery'),
  S('REFINERY_PPU', 'Refinery-PPU', 'Refinery'),
  S('SRU', 'SRU', 'Refinery'),
  S('VGO', 'VGO', 'Refinery'),
  S('DFCU_AU', 'DFCU (AU)', 'Petchem'),
  S('DFCU_COLD', 'DFCU (COLD)', 'Petchem'),
  S('DFCU_HOT', 'DFCU (HOT)', 'Petchem'),
  S('HDPE', 'HDPE', 'Petchem'),
  S('PE_SWING_LINE_1', 'PE-SWING-LINE-1', 'Petchem'),
  S('PE_SWING_LINE_2', 'PE-SWING-LINE-2', 'Petchem'),
  S('PETCHEM_OFFSITE', 'Petchem Offsite', 'Petchem'),
  S('PETCHEM_PPU', 'Petchem-PPU', 'Petchem'),
];
const REFINERY = SECTIONS.filter((s) => s.category === 'Refinery').map((s) => s.key);
const PETCHEM = SECTIONS.filter((s) => s.category === 'Petchem').map((s) => s.key);

const CASES: [string, string[]][] = [
  ['Refinery Read', REFINERY],
  ['Petchem Read', PETCHEM],
  ['All Read rights', [...REFINERY, ...PETCHEM]],
  ['test-subuser', []],
  ['Petchem PPU - HDPE', ['PETCHEM_PPU', 'HDPE']],
  ['SRU Refineryoffsite edit', ['SRU', 'REFINERY_OFFSITE']],
  ['FCC PPU Edit', ['FCC_PC', 'REFINERY_PPU']],
  ['PE-SWING Read', ['PE_SWING_LINE_1', 'PE_SWING_LINE_2']],
  ['DCU CDU Edit', ['DCU', 'CDU']],
  ['Refinery-PPU Read', ['REFINERY_PPU']],
  ['HGU Read', ['HGU']],
  ['CDU Read', ['CDU']],
];

let failures = 0;
for (const [roleName, expected] of CASES) {
  const got = resolveRoleSections(roleName, SECTIONS).sort();
  const want = [...expected].sort();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${roleName.padEnd(28)} -> ${got.join(',') || '(none)'}${ok ? '' : `  EXPECTED ${want.join(',')}`}`);
}

// deriveAccess basics
const roles = [
  { roleId: 'r1', roleName: 'Refinery Read', subUsers: ['u-read'] },
  { roleId: 'r2', roleName: 'test-subuser', subUsers: ['u-none'] },
  { roleId: 'r3', roleName: 'All acess', subUsers: ['u-allaccess'] },
  { roleId: 'r4', roleName: 'HGU Edit', subUsers: ['u-edit'] },
];
const admin = deriveAccess('u-main', roles, SECTIONS);
const read = deriveAccess('u-read', roles, SECTIONS);
const none = deriveAccess('u-none', roles, SECTIONS);
const allAccess = deriveAccess('u-allaccess', roles, SECTIONS);
const editUser = deriveAccess('u-edit', roles, SECTIONS);
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
check('main account -> admin', admin.access?.kind === 'admin');
check('Refinery Read -> scoped 12 keys', read.access?.kind === 'scoped' && read.access.sectionKeys.length === REFINERY.length);
check('role w/o units -> no access', none.access === null && none.memberRoles.length === 1);
check('"All acess" member -> full admin', allAccess.access?.kind === 'admin' && allAccess.memberRoles.length === 1);
check('Edit role -> READ access to its section', editUser.access?.kind === 'scoped' && editUser.access.sectionKeys.join() === 'HGU');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
