# HMEL Steamtrap Reports — HTTP Routes Reference

Every HTTP route the report service exposes, and what each is for. This documents **our app's own
routes** (not the IOsense APIs we *consume* — those are in [`iosense.md`](./iosense.md)).

## Where the routes live (two servers)

| Server | Entry | Port | Routes mounted | Purpose |
|---|---|---|---|---|
| **Production** | `scheduler.ts` → `fileServer.ts` | **9010** | `/report/*`, `/api/*`, static UI | The live app: runs the cron scheduler, serves report files to IOsense, serves the admin UI + API. URL: `https://81614037-…-c4d2278f.iocompute.ai/` |
| **Test / admin** | `adminServer.ts` | **5010** | `/api/*`, static UI | Standalone admin/test server — **no scheduler, never emails**. Same `/api` + UI for safe previewing. URL: `https://app-e7d73c89.iocompute.ai/` |

Both mount the **same `/api` router** (`src/api/adminApi.ts`). Only the production `fileServer` has
`/report/*` (the email-attachment delivery route). Everything under `/api` is additive and read-mostly;
nothing there mutates `.env` or the cron jobs.

---

## 1. File delivery — `/report/:fileName`  *(production only)*

**`GET /report/:fileName`** — serves a generated report `.xlsx`, then **deletes it**.

- **Who calls it:** IOsense's email service, when it fetches the attachment URL we put in each email
  (`REPORT_BASE_URL/report/<file>`). Pull-based delivery — we hand IOsense a URL, it downloads the file.
- **Behavior:** streams the file from `OUTPUT_DIR`, then removes it (one-shot; the file only needs to
  live long enough for IOsense to fetch it). Logs the resolved path + bytes sent for auditing.
- **Not** the permanent copy — archived reports are downloaded via `/api/archive/*` (below), which does
  *not* delete.

---

## 2. Admin API — `/api/*`

Base path `/api`. Consumed by the admin UI (`frontend/src/services/adminApi.ts`). JSON unless noted.

### Health
- **`GET /api/health`** — liveness probe. Returns `{ ok: true }`.

### Report log (the "View" / "Generate & View" tab)
- **`GET /api/report-log`** — the send-log table. Query params: `type` (daily|weekly|generated),
  `status` (sent|failed|skipped|generation-failed|generated), `section`, `q` (free-text search over
  section/file/recipient), `from`, `to`, `limit`. Returns `{ total, entries[] }`; each entry includes
  `time, reportType, section, status, fileName, recipients[], error?, rangeStart?, rangeEnd?,
  downloadable`. `downloadable` is computed live (file still on disk: archive for sent reports,
  generated dir for on-demand).
- **`GET /api/archive/:fileName`** — download an **emailed** report that was archived (does *not*
  delete). Source: `ARCHIVE_DIR` (every sent daily/weekly is copied here before send). Only works for
  reports sent after archiving was deployed.

### On-demand generation (the "Generate" modal)
- **`GET /api/sections`** — the unit picker. Returns `{ sections: [{ key, name, category }] }` where
  `category` is the parent plant (Refinery / Petchem) that drives the cascading parent→child select.
- **`POST /api/generate`** — start a custom-range Analysis report. Body `{ unitKeys[], start, end }`
  (empty `unitKeys` = all; max 31 days). Returns `{ jobId }` (202). Runs async; files land in
  `GENERATED_DIR` and are logged to the send-log with status `generated`.
- **`GET /api/generate/:id`** — poll a generation job: `{ id, status (running|done|failed),
  progressLabel, files[], error? }`. Jobs are in-memory (don't survive a restart).
- **`GET /api/generated/:fileName`** — download an on-demand generated report (does *not* delete).
  Source: `GENERATED_DIR`.

### Schedules & overrides (the "Schedule" tab)
All schedule/recipient changes go to the **runtime overrides file** (`LOG_DIR/report-overrides.txt`),
**never `.env`**, and are re-read by the scheduler at fire time — the running scheduler is never
restarted. Send *times* come from `.env` and are read-only here.

- **`GET /api/schedules`** — the schedule table. Returns `{ pauseAll, overrideErrors[], schedules[] }`;
  each schedule: `{ key, name, type (daily|weekly), sendTime, paused, recipients[],
  recipientsOverridden, lastRun? }`.
- **`POST /api/schedules/pause-all`** / **`POST /api/schedules/resume-all`** — pause/resume *all*
  reports (writes/clears the pause-all flag in the overrides file).
- **`POST /api/schedules/:key/pause`** / **`POST /api/schedules/:key/resume`** — pause/resume one
  section (unit for daily, category for weekly), by its env-key.
- **`PUT /api/schedules/:key/recipients`** — override one section's recipient list. Body
  `{ type (daily|weekly), recipients: string[] | null }`. `null` reverts to the `.env` list.
- **`GET /api/overrides`** — current overrides state (parsed + any parse errors).
- **`GET /api/overrides/export`** — download the raw `report-overrides.txt` (for Notepad editing).
- **`POST /api/overrides/validate`** — dry-run: body `{ text }` → `{ pauseAll, pausedKeys[],
  recipients{}, errors[] }` (preview what a pasted/edited file would do, before applying).
- **`PUT /api/overrides`** — apply a full overrides file. Body `{ text }`; validates then atomically
  writes it. Returns the validation result + `{ ok }`.

---

## 3. Static UI + SPA fallback

- **`express.static(FRONTEND_DIST_DIR)`** — serves the built admin UI (`frontend/dist`).
- **SPA fallback** — any GET that isn't `/report/*` or `/api/*` returns `index.html` (so client-side
  routing works). On the test server the exclusion is just `/api/*` (no `/report`).

---

## Related directories (where files served by these routes live)

| Dir (config key) | Default | Served by | Deleted on serve? |
|---|---|---|---|
| `OUTPUT_DIR` (`REPORT_OUTPUT_DIR`) | `backend/output` | `/report/:fileName` | **yes** (one-shot) |
| `ARCHIVE_DIR` (`REPORT_ARCHIVE_DIR`) | `backend/archive` | `/api/archive/:fileName` | no |
| `GENERATED_DIR` (`REPORT_GENERATED_DIR`) | `backend/generated` | `/api/generated/:fileName` | no |
| `LOG_DIR` (`REPORT_LOG_DIR`) | `backend/logs` | (not served) holds `report-log.*`, `report-overrides.txt`, `daily-stats/` | — |

See also: [`iosense.md`](./iosense.md) (the IOsense APIs the reports *consume*), and `CLAUDE.md`.
