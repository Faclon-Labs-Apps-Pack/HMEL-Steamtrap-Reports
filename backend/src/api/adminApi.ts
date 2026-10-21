import express, { type Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import {
  LOG_DIR,
  ARCHIVE_DIR,
  GENERATED_DIR,
  envKey,
  getDailyRecipientsForUnit,
  getWeeklyRecipientsForCategory,
} from '../config';
import {
  loadOverrides,
  parseOverrides,
  readOverridesText,
  serializeOverrides,
  writeOverridesText,
  isPaused,
  overrideRecipients,
  type Overrides,
} from '../scheduler/overrides';
import { generateRangeAnalysisWorkbooks } from '../reportGeneration/generateRangeAnalysisReport';
import { saveWorkbook } from '../reportGeneration/saveWorkbook';
import { derivePlantCategory } from '../lib/plantCategory';
import { logReport } from '../scheduler/reportLog';
import { createAuthMiddleware, requireAdmin, recordPairing, getSession, AUTH_ENABLED } from './authMiddleware';
import { resolveActingUser } from './iosenseSubUser';
import { describeAccess, type KnownSection } from './access';
import { mintDownloadPath, verifyDownload, type DownloadKind } from './signedDownloads';
import { API_BASE } from '../config';

/**
 * The admin UI's REST API (report send-log, schedule/recipient management via the overrides file,
 * on-demand custom-range generation). Mounted by BOTH entry points:
 *   - src/adminServer.ts — the standalone test/admin server (no scheduler, never emails);
 *   - src/scheduler.ts via fileServer.ts — production, same process as the scheduler.
 * Everything here is additive: nothing mutates .env, OUTPUT_DIR, or the scheduler's cron jobs.
 */

// ---------------------------------------------------------------------------
// Report log
// ---------------------------------------------------------------------------

interface LogEntry {
  time: string;
  reportType: 'weekly' | 'daily' | 'generated';
  section: string;
  status: string;
  fileName?: string;
  recipients?: string[];
  error?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

async function readReportLog(): Promise<LogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(LOG_DIR, 'report-log.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const entries: LogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A corrupt line must not hide the rest of the history.
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Sections / schedules (derived from env + the log, merged with overrides)
// ---------------------------------------------------------------------------

const WEEKLY_CATEGORIES = ['Refinery', 'Petchem'];

/** Daily unit env-keys: every <KEY>_DAILY_RECIPIENTS / <KEY>_DAILY_TIME var defines a unit. */
function dailyUnitKeysFromEnv(): string[] {
  const keys = new Set<string>();
  for (const name of Object.keys(process.env)) {
    const m = /^(.+)_DAILY_(RECIPIENTS|TIME)$/.exec(name);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

/** Best-effort display name per env-key, learned from the send-log's real section names. */
async function displayNamesByKey(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const e of await readReportLog()) {
    if (e.section && !e.section.startsWith('(')) map.set(envKey(e.section), e.section);
  }
  return map;
}

interface ScheduleView {
  key: string;
  name: string;
  type: 'daily' | 'weekly';
  sendTime: string;
  paused: boolean;
  recipients: string[];
  /** True when the recipient list comes from report-overrides.txt rather than .env. */
  recipientsOverridden: boolean;
  lastRun?: { time: string; status: string; fileName?: string; error?: string };
}

async function buildSchedules(ov: Overrides): Promise<ScheduleView[]> {
  const names = await displayNamesByKey();
  const log = await readReportLog();
  const lastRunFor = (key: string, type: 'daily' | 'weekly') => {
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.reportType === type && e.section && envKey(e.section) === key) {
        return { time: e.time, status: e.status, fileName: e.fileName, error: e.error };
      }
    }
    return undefined;
  };

  const schedules: ScheduleView[] = [];
  for (const key of dailyUnitKeysFromEnv()) {
    const name = names.get(key) ?? key;
    const ovRecipients = overrideRecipients(ov, key, 'daily');
    schedules.push({
      key,
      name,
      type: 'daily',
      sendTime: process.env[`${key}_DAILY_TIME`]?.trim() || process.env.DAILY_REPORT_TIME?.trim() || '(not scheduled)',
      paused: isPaused(ov, key),
      recipients: ovRecipients ?? getDailyRecipientsForUnit(name),
      recipientsOverridden: ovRecipients !== null,
      lastRun: lastRunFor(key, 'daily'),
    });
  }
  for (const category of WEEKLY_CATEGORIES) {
    const key = envKey(category);
    const day = process.env[`${key}_WEEKLY_DAY`]?.trim() || process.env.WEEKLY_REPORT_DAY?.trim();
    const time = process.env[`${key}_WEEKLY_TIME`]?.trim() || process.env.WEEKLY_REPORT_TIME?.trim();
    const ovRecipients = overrideRecipients(ov, key, 'weekly');
    schedules.push({
      key,
      name: category,
      type: 'weekly',
      sendTime: day && time ? `day ${day} @ ${time}` : '(not scheduled)',
      paused: isPaused(ov, key),
      recipients: ovRecipients ?? getWeeklyRecipientsForCategory(category),
      recipientsOverridden: ovRecipients !== null,
      lastRun: lastRunFor(key, 'weekly'),
    });
  }
  return schedules;
}

// ---------------------------------------------------------------------------
// On-demand generation jobs (custom-range Analysis-only reports)
// ---------------------------------------------------------------------------

interface GenerateJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  progressLabel: string;
  params: { unitKeys: string[]; start: string; end: string };
  files: { fileName: string; unitName: string }[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, GenerateJob>();
let runningJobId: string | null = null;

const MAX_RANGE_DAYS = 31;

function startGenerateJob(unitKeys: string[], start: Date, end: Date): GenerateJob {
  const job: GenerateJob = {
    id: randomUUID(),
    status: 'running',
    progressLabel: 'Starting…',
    params: { unitKeys, start: start.toISOString(), end: end.toISOString() },
    files: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  runningJobId = job.id;

  (async () => {
    try {
      const reports = await generateRangeAnalysisWorkbooks(
        { start, end },
        unitKeys.length > 0 ? { unitKeys } : undefined,
        (p) => {
          job.progressLabel = p.label;
        },
      );
      for (const r of reports) {
        job.progressLabel = `Saving ${r.fileName}…`;
        await saveWorkbook(r.workbook, GENERATED_DIR, r.fileName);
        job.files.push({ fileName: r.fileName, unitName: r.unitName });
        // Record every on-demand report in the shared send-log so it shows up in View Reports
        // (with a Download that points at GENERATED_DIR). Never emailed, so no recipients.
        await logReport({
          reportType: 'generated',
          section: r.unitName,
          status: 'generated',
          fileName: r.fileName,
          rangeStart: start.toISOString(),
          rangeEnd: end.toISOString(),
        });
      }
      job.status = 'done';
      job.progressLabel = `Done — ${job.files.length} file(s).`;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.progressLabel = 'Failed.';
      await logReport({
        reportType: 'generated',
        section: unitKeys.length > 0 ? unitKeys.join(', ') : '(all units)',
        status: 'generation-failed',
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        error: job.error,
      });
    } finally {
      job.finishedAt = new Date().toISOString();
      if (runningJobId === job.id) runningJobId = null;
    }
  })();

  return job;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** All known sections with display name + plant category — feeds /sections, role scoping, and the auth middleware. */
async function listKnownSections(): Promise<KnownSection[]> {
  const names = await displayNamesByKey();
  return dailyUnitKeysFromEnv().map((key) => {
    const name = names.get(key) ?? key;
    return { key, name, category: derivePlantCategory(name) };
  });
}

/**
 * Serves one permanent report copy. Downloads are plain <a> links (no Authorization header
 * possible), so they are authorized by a short-lived HMAC signature minted into the JSON
 * responses (see signedDownloads.ts) — and those responses are themselves role-scoped, so a
 * scoped user can only ever hold signatures for their own sections' files.
 */
async function downloadFrom(kind: DownloadKind, dir: string, rawName: string, req: express.Request, res: express.Response): Promise<void> {
  const fileName = path.basename(rawName); // path-traversal guard
  if (AUTH_ENABLED && !verifyDownload(kind, fileName, req.query.exp, req.query.sig)) {
    res.status(403).json({ error: 'Download link expired — refresh the table and try again.' });
    return;
  }
  const filePath = path.join(dir, fileName);
  try {
    await stat(filePath);
  } catch {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  // Unlike /report/:fileName this does NOT delete after download — these are the permanent copies.
  res.download(filePath, fileName);
}

export function createAdminApiRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // --- Pre-auth routes -------------------------------------------------------
  // SSO exchange runs THROUGH the backend so IOsense itself hands us the verified
  // token↔userId pairing (the browser token is opaque — we must never trust a client-claimed
  // userId; see authMiddleware.ts).
  router.post('/session/sso-exchange', async (req, res) => {
    const ssoToken = typeof req.body?.ssoToken === 'string' ? req.body.ssoToken.trim() : '';
    if (!ssoToken) {
      res.status(400).json({ error: 'ssoToken is required.' });
      return;
    }
    try {
      const upstream = await fetch(`${API_BASE}/retrieve-sso-token/${encodeURIComponent(ssoToken)}`, {
        headers: { organisation: 'https://iosense.io', 'ngsw-bypass': 'true', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await upstream.json().catch(() => null)) as
        | { success?: boolean; token?: string; organisation?: string; userId?: string; errors?: string[] }
        | null;
      if (!upstream.ok || !data?.success || !data.token || !data.userId) {
        res.status(401).json({ error: data?.errors?.join(', ') || 'SSO token exchange failed — get a fresh link from the IOsense portal.' });
        return;
      }
      // The exchange reports the PARENT account's userId even for sub-user sessions (IOsense
      // behavior, confirmed 2026-10-21) — resolve the ACTUAL person via getSubUsers, which the
      // session token can call and which returns `currentUser` (their login email).
      const acting = await resolveActingUser(data.token);
      let effectiveUserId = data.userId;
      if (acting) {
        if (acting.subUserId && !acting.isParent) {
          effectiveUserId = acting.subUserId;
        } else if (!acting.isParent && !acting.subUserId) {
          console.warn(`[sso-exchange] currentUser ${acting.email} not found in the sub-user directory — treating as main account.`);
        }
        console.log(`[sso-exchange] signed in: ${acting.email} (${acting.isParent ? 'parent/master' : acting.subUserId ? 'sub-user ' + acting.subUserId : 'unmatched'})`);
      } else {
        console.warn('[sso-exchange] getSubUsers unavailable — falling back to the exchange userId (parent).');
      }
      await recordPairing(data.token, effectiveUserId, data.organisation, acting?.email);
      res.json({ token: data.token, organisation: data.organisation, userId: data.userId });
    } catch (err) {
      res.status(503).json({ error: `IOsense unreachable during sign-in: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // Downloads authenticate by signed URL (minted into role-scoped responses), not by header.
  router.get('/archive/:fileName', (req, res) => void downloadFrom('archive', ARCHIVE_DIR, req.params.fileName, req, res));
  router.get('/generated/:fileName', (req, res) => void downloadFrom('generated', GENERATED_DIR, req.params.fileName, req, res));

  // --- Everything below requires a valid IOsense session --------------------
  router.use(createAuthMiddleware(listKnownSections));

  router.get('/me', async (_req, res) => {
    const session = getSession(res);
    res.json({
      userId: session.userId,
      name: session.name,
      email: session.email,
      roleNames: session.roleNames,
      access: session.access,
      accessLabel: describeAccess(session.access, await listKnownSections()),
    });
  });

  // --- View Reports tab ---------------------------------------------------
  router.get('/report-log', async (req, res) => {
    try {
      let entries = await readReportLog();
      // Role scoping FIRST, before any user-supplied filter: scoped users only ever see (and
      // get counts for) their own sections' rows — user filters can narrow, never widen.
      const access = getSession(res).access;
      if (access.kind === 'scoped') {
        const allowed = new Set(access.sectionKeys);
        entries = entries.filter((e) => e.section && allowed.has(envKey(e.section)));
      }
      const { type, excludeType, status, section, q, from, to } = req.query as Record<string, string | undefined>;
      if (type) entries = entries.filter((e) => e.reportType === type);
      // Lets the View Reports tab show only SCHEDULED sends (excludeType=generated) while the
      // Generate tab shows only on-demand ones (type=generated) — same log, two views.
      if (excludeType) entries = entries.filter((e) => e.reportType !== excludeType);
      if (status) entries = entries.filter((e) => e.status === status);
      if (section) entries = entries.filter((e) => e.section && envKey(e.section) === envKey(section));
      if (from) entries = entries.filter((e) => e.time >= new Date(from).toISOString());
      if (to) entries = entries.filter((e) => e.time <= new Date(to).toISOString());
      if (q) {
        const needle = q.toLowerCase();
        entries = entries.filter((e) =>
          [e.section, e.fileName, e.error, ...(e.recipients ?? [])].join(' ').toLowerCase().includes(needle),
        );
      }
      entries.sort((a, b) => b.time.localeCompare(a.time));
      const limit = Math.min(Number(req.query.limit ?? 300), 2000);
      const total = entries.length;
      // Real aggregate counts over the FULL filtered set (not just the returned page) — powers
      // the summary metrics row in the UI. Never fabricated: same rows the table paginates.
      const counts: Record<string, number> = {};
      for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
      entries = entries.slice(0, limit);

      // Flag which files still exist on disk (downloadable) — one readdir per dir, not N stats.
      // Emailed reports live in ARCHIVE_DIR; on-demand `generated` reports live in GENERATED_DIR.
      let archived = new Set<string>();
      let generated = new Set<string>();
      try {
        archived = new Set(await readdir(ARCHIVE_DIR));
      } catch {
        // no archive dir yet
      }
      try {
        generated = new Set(await readdir(GENERATED_DIR));
      } catch {
        // no generated dir yet
      }
      const isGenerated = (e: LogEntry) => e.reportType === 'generated' || e.status === 'generated';
      res.json({
        total,
        counts,
        entries: entries.map((e) => {
          const downloadable = !!e.fileName && (isGenerated(e) ? generated.has(e.fileName) : archived.has(e.fileName));
          return {
            ...e,
            downloadable,
            // Short-lived signed link — the only way a browser <a> can authorize a download.
            downloadUrl: downloadable && e.fileName ? mintDownloadPath(isGenerated(e) ? 'generated' : 'archive', e.fileName) : undefined,
          };
        }),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Generate Report tab --------------------------------------------------
  router.get('/sections', async (_req, res) => {
    try {
      // `category` is the parent plant (Refinery / Petchem) — drives the cascading parent→child
      // section picker in the Generate modal. Scoped users only see their own sections.
      let sections = await listKnownSections();
      const access = getSession(res).access;
      if (access.kind === 'scoped') {
        const allowed = new Set(access.sectionKeys);
        sections = sections.filter((s) => allowed.has(s.key));
      }
      res.json({ sections });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/generate', requireAdmin, (req, res) => {
    const { unitKeys, start, end } = req.body ?? {};
    if (!Array.isArray(unitKeys) || unitKeys.some((k) => typeof k !== 'string')) {
      res.status(400).json({ error: 'unitKeys must be an array of section keys (empty = all sections).' });
      return;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      res.status(400).json({ error: 'start and end must be valid datetimes.' });
      return;
    }
    if (startDate >= endDate) {
      res.status(400).json({ error: 'start must be before end.' });
      return;
    }
    if (endDate.getTime() - startDate.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: `Range too large — maximum ${MAX_RANGE_DAYS} days per report.` });
      return;
    }
    if (runningJobId && jobs.get(runningJobId)?.status === 'running') {
      res.status(409).json({ error: 'Another generation is already running — wait for it to finish.', jobId: runningJobId });
      return;
    }
    const job = startGenerateJob(unitKeys.map((k: string) => envKey(k)), startDate, endDate);
    res.status(202).json({ jobId: job.id });
  });

  router.get('/generate/:id', requireAdmin, (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: 'Unknown job (jobs do not survive a server restart — start a new one).' });
      return;
    }
    res.json(job);
  });

  // --- Schedule Report tab (admin-only, including overrides import/export) ---
  router.use(['/schedules', '/overrides'], requireAdmin);

  router.get('/schedules', async (_req, res) => {
    try {
      const ov = await loadOverrides();
      res.json({
        pauseAll: ov.pauseAll,
        overrideErrors: ov.errors,
        schedules: await buildSchedules(ov),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Applies a structured mutation to the overrides model and atomically rewrites the file. */
  async function mutateOverrides(mutate: (ov: Overrides) => void): Promise<Overrides> {
    const ov = await loadOverrides();
    mutate(ov);
    await writeOverridesText(serializeOverrides(ov));
    return ov;
  }

  router.post('/schedules/pause-all', async (_req, res) => {
    try {
      await mutateOverrides((ov) => {
        ov.pauseAll = true;
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/schedules/resume-all', async (_req, res) => {
    try {
      await mutateOverrides((ov) => {
        ov.pauseAll = false;
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/schedules/:key/pause', async (req, res) => {
    try {
      await mutateOverrides((ov) => ov.pausedKeys.add(envKey(req.params.key)));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/schedules/:key/resume', async (req, res) => {
    try {
      await mutateOverrides((ov) => void ov.pausedKeys.delete(envKey(req.params.key)));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/schedules/:key/recipients', async (req, res) => {
    const { type, recipients } = req.body ?? {};
    if (type !== 'daily' && type !== 'weekly') {
      res.status(400).json({ error: 'type must be "daily" or "weekly".' });
      return;
    }
    if (recipients !== null && (!Array.isArray(recipients) || recipients.some((r) => typeof r !== 'string'))) {
      res.status(400).json({ error: 'recipients must be an array of email addresses, or null to revert to .env.' });
      return;
    }
    const overrideKey = `${envKey(req.params.key)}_${(type as string).toUpperCase()}_RECIPIENTS`;
    try {
      if (recipients === null) {
        await mutateOverrides((ov) => void ov.recipients.delete(overrideKey));
        res.json({ ok: true, reverted: true });
        return;
      }
      const emails = (recipients as string[]).map((s) => s.trim()).filter(Boolean);
      // Reuse the file parser as the single source of validation truth.
      const check = parseOverrides(`${overrideKey}: ${emails.join(', ')}`);
      if (check.errors.length > 0) {
        res.status(400).json({ error: check.errors[0].message });
        return;
      }
      await mutateOverrides((ov) => void ov.recipients.set(overrideKey, emails));
      res.json({ ok: true, recipients: emails });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Overrides file: Notepad round-trip (export / validate / import) ------
  router.get('/overrides', async (_req, res) => {
    try {
      const text = (await readOverridesText()) ?? serializeOverrides((await loadOverrides()));
      const parsed = parseOverrides(text);
      res.json({
        text,
        pauseAll: parsed.pauseAll,
        pausedKeys: [...parsed.pausedKeys],
        recipients: Object.fromEntries(parsed.recipients),
        errors: parsed.errors,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/overrides/export', async (_req, res) => {
    const text = (await readOverridesText()) ?? serializeOverrides(await loadOverrides());
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="report-overrides.txt"');
    res.send(text);
  });

  /** Dry-run: parse the candidate text and report what it would do — nothing is written. */
  router.post('/overrides/validate', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const parsed = parseOverrides(text);
    res.json({
      pauseAll: parsed.pauseAll,
      pausedKeys: [...parsed.pausedKeys],
      recipients: Object.fromEntries(parsed.recipients),
      errors: parsed.errors,
    });
  });

  router.put('/overrides', async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string') {
      res.status(400).json({ error: 'Body must be { "text": "<file contents>" }.' });
      return;
    }
    const parsed = parseOverrides(text);
    try {
      await writeOverridesText(text);
      res.json({
        ok: true,
        pauseAll: parsed.pauseAll,
        pausedKeys: [...parsed.pausedKeys],
        recipients: Object.fromEntries(parsed.recipients),
        // Errors don't block the save (the scheduler ignores bad lines anyway) but are returned
        // so the UI can warn — the user may prefer to fix and re-upload.
        errors: parsed.errors,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
