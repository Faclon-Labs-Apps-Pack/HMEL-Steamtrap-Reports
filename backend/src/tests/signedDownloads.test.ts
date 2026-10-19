/** Run: npx tsx src/tests/signedDownloads.test.ts */
export {};
process.env.DOWNLOAD_SIGNING_SECRET = 'test-secret';
const { mintDownloadPath, verifyDownload } = await import('../api/signedDownloads');

const url = mintDownloadPath('archive', 'Steam Trap Daily Report–HGU-19-10-26.xlsx');
const u = new URL(`http://x${url}`);
const fileName = decodeURIComponent(u.pathname.split('/').pop()!);
const exp = u.searchParams.get('exp')!;
const sig = u.searchParams.get('sig')!;

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
check('valid signature verifies', verifyDownload('archive', fileName, exp, sig));
check('wrong kind rejected', !verifyDownload('generated', fileName, exp, sig));
check('tampered exp rejected', !verifyDownload('archive', fileName, String(Number(exp) + 1), sig));
check('other file rejected', !verifyDownload('archive', 'other.xlsx', exp, sig));
check('expired rejected', !verifyDownload('archive', fileName, String(Date.now() - 1000), sig));
check('garbage sig rejected', !verifyDownload('archive', fileName, exp, 'zz'));
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
