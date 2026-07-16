# Backend — Automated Report Generation & Email

Standalone Node service that generates the same two Excel reports as the frontend's
"Generate Management Report" / "Generate Daily Report" buttons, but automatically — on a
schedule, emailed to configured recipients, no browser or manual click involved.

Authenticates with a **Personal Access Token (PAT)** instead of the frontend's SSO/JWT flow —
PATs don't expire, which is what makes unattended automation possible.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `IOSENSE_PAT`, `IOSENSE_ORG_ID` — from an IOsense admin.
- `MANAGEMENT_REPORT_CRON` — cron expression for when the (weekly) Management Report should be
  **ready**, e.g. `0 6 * * 1` for Monday 6:00 AM. Needs a day-of-week, so it's cron-only.
- `DAILY_REPORT_TIME` — plain 24-hour `HH:MM` for when the Daily Report should be ready, e.g.
  `06:00`. No cron syntax needed since it has no day-of-week. (If you'd rather use a raw cron
  expression here too — e.g. to skip weekends — set `DAILY_REPORT_CRON` instead and leave
  `DAILY_REPORT_TIME` blank; `DAILY_REPORT_TIME` wins if both are set.)
  In both cases, the service starts generating the report a few minutes *before* this time (see
  `REPORT_LEAD_TIME_MINUTES` below) and emails it *exactly at* this time. All times are
  interpreted as **IST**, regardless of the server's own system timezone (override with
  `REPORT_TIMEZONE`, an IANA name, if needed).
- `REPORT_LEAD_TIME_MINUTES` — how many minutes before the scheduled time generation should
  start (default 15). E.g. scheduled for `10:10` with `REPORT_LEAD_TIME_MINUTES=2` means
  generation starts at `10:08`; the email still goes out at `10:10`, not earlier, regardless of
  how quickly generation finishes.
- `MANAGEMENT_REPORT_RECIPIENTS`, `DAILY_REPORT_RECIPIENTS` — comma-separated email addresses.
- `REPORT_BASE_URL` — **must be a publicly reachable URL**, not localhost. See "Email delivery"
  below for why this is non-negotiable.

## Two ways to run this

**One-shot, manual/externally-scheduled** (no email, no `.env` scheduling/recipient vars needed):
```bash
npm run generate              # both reports, written to output/
npm run generate:management
npm run generate:daily
```
Use this if you'd rather drive scheduling from cron/systemd/CI yourself and handle delivery
separately.

**Scheduler daemon** (generates AND emails automatically, on the cron schedules in `.env`):
```bash
npm start
```
This is a long-running process — keep it alive with pm2, systemd, Docker, or similar. It:
1. Starts a small HTTP file server (`fileServer.ts`) exposing `GET /report/:fileName`.
2. Recovers any report that was generated but never sent from a previous run (e.g. the process
   restarted mid-cycle) — see `output/pending-emails.json` below.
3. At `REPORT_LEAD_TIME_MINUTES` (default 15) before each report's scheduled time: generates the
   report, saves it, and records a `output/pending-emails.json` entry (recipients, attachment
   URL, when it's due).
4. At the scheduled time itself: sends the email via IOsense's `sendEmail` API with a link back
   to the file server as the attachment, then removes the pending entry.
5. Reschedules itself for the next occurrence (handles daily and weekly cron patterns correctly
   — not a fixed interval).

`output/pending-emails.json` is what makes step 4 crash-safe — if this process dies between
generating and sending, the entry survives on disk and gets picked up by step 2 on the next
start, instead of the report silently never going out.

## Email delivery — how it actually works

IOsense's `sendEmail` API (`PUT /account/sendEmail`) does **not** accept uploaded file bytes.
Attachments are pull-based: you give it a URL, and IOsense's own servers issue a `GET` against
that URL to fetch the file. This means:

- `REPORT_BASE_URL` must be reachable from the public internet — IOsense's servers need to
  reach it, not just your machine. Pointing it at `localhost` will make the email API call
  succeed, but the attachment will be missing/broken because IOsense can never fetch it.
- The file server (`fileServer.ts`) serves each report **exactly once**: `GET /report/:fileName`
  streams the file, then deletes it immediately after that first successful download. Anything
  older than 24h (never collected) gets `410 Gone` and is cleaned up.
- The email body/layout itself is a fixed template (`"reports reportMail"`) that lives on the
  IOsense platform side, not in this codebase — this service only supplies the recipients,
  subject, attachment URLs, and a few template variables (title, generation time, message).

## Deploying to your own VM

The backend serves the frontend's production build itself, on the same port as `/report/*` —
**one process, one port**, so there's no reverse-proxy path-routing rule to get wrong (a
misconfigured proxy pointing report requests at the frontend's dev server instead of this
service is exactly what causes "corrupted"/HTML attachments — see the frontend build step below).

1. Build the frontend once: `cd frontend && npm run build` — produces `frontend/dist`. The
   backend auto-detects this at startup (`FRONTEND_DIST_DIR` in `config.ts`) and serves it as
   static files, with an SPA fallback, from `fileServer.ts`. Do NOT run `vite` (the dev server)
   in production — a live dev server has no `/report/:fileName` route, so any reverse proxy
   pointed at it would 404/serve `index.html` in place of the actual report.
2. Pick a port for the file server (`FILE_SERVER_PORT` in `.env`, or the standard `PORT` env var
   if your process manager already sets one — either works, `FILE_SERVER_PORT` wins if both are
   set). Defaults to 3000 if neither is set.
3. Point a domain (or your VM's static IP, if you don't have one) at that **same** port — this
   now serves both the dashboard (`/`) and the report attachments (`/report/:fileName`):
   - **With a reverse proxy** (nginx/Caddy/etc. terminating TLS) forwarding to
     `localhost:<FILE_SERVER_PORT>` — this is the recommended setup. Then
     `REPORT_BASE_URL=https://reports.yourdomain.com`.
   - **Direct, no reverse proxy** — open that port in your firewall/security group, then
     `REPORT_BASE_URL=http://<your-vm-ip>:<FILE_SERVER_PORT>`. Works, but no TLS.
4. Keep `npm start` running persistently — it's a long-running process, not a one-shot script.
   `pm2 start npm --name steam-trap-scheduler -- start` or a systemd unit both work fine; either
   just needs to restart it if the process dies or the VM reboots. If you update the frontend,
   re-run `npm run build` in `frontend/` and restart this process to pick up the new build.

That's the whole setup — `REPORT_BASE_URL` never needs to change again unless you move the
service to a different machine/domain.

(Local development is unaffected by any of this — `npm run dev` at the repo root still runs the
frontend's live Vite dev server on its own port alongside the backend daemon, exactly as before.
The unified single-port build is a *production* deployment concern only.)

(One thing I checked and ruled out: this coding sandbox's own dev-preview proxy
(`VSCODE_PROXY_URI`, if you ever see it referenced) requires the browser's own login session to
pass through — confirmed live, an unauthenticated request gets `401`. IOsense's servers can't
authenticate through it, so it can never work for `REPORT_BASE_URL`, even for quick testing.)

## Structure

Mirrors `frontend/src/{lib,services,reportGeneration}/` — same business logic, ported to run in
Node instead of the browser. Differences from the frontend:

- `src/config.ts` — reads `IOSENSE_PAT`/`IOSENSE_ORG_ID` from `.env` instead of the browser's SSO
  exchange / `localStorage`. Unlike the browser JWT flow (confirmed live to work without an
  `organisation` header), the PAT isn't bound to one org via an SSO exchange, so every API call
  here sends `organisation: <IOSENSE_ORG_ID>` explicitly.
- `src/reportGeneration/saveWorkbook.ts` — writes the `.xlsx` to disk instead of triggering a
  browser download.
- `src/fileServer.ts`, `src/email/sendReportEmail.ts`, `src/scheduler/`, `src/scheduler.ts` —
  new, no frontend equivalent (email delivery + scheduling only make sense server-side).

If report logic changes on the frontend (new columns, different formulas, etc.), the matching
files here need the same change — there's no shared package between the two right now, they're
independent copies that started identical.

## A note on `.env` vs `.env.example`

Real secrets go in `.env` only. `.env.example` is the checked-into-git template — never put a
real token/password there. (`.gitignore` treats `.env*` as ignored except `.env.example`
specifically, which is the one meant to be committed.)
