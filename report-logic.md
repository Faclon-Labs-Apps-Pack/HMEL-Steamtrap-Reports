# HMEL Steamtrap Reports — Logic Reference (section by section)

How every number in the reports is computed, and the logic behind each part of the system. For the
HTTP routes see [`report-routes.md`](./report-routes.md); for the IOsense APIs consumed see
[`iosense.md`](./iosense.md).

---

## A. Core concepts (used everywhere)

### A1. Time windows
| Window | Meaning | Source |
|---|---|---|
| **DTD** (report day) | the previous fully-completed calendar day, 00:00:00–23:59:59 IST | `getPreviousDayRange` |
| **WTD** | trailing 7 days ending on the report day | `getTrailing7DayRange` |
| **MTD** | 1st of the month 00:00 → report day | `getMonthToDateRange` |
| **YTD / "Till Date"** | **fixed anchor 1-Sep-2026** → report day (monitoring start; not Apr–Mar) | `getTillDateRange` / `MONITORING_START` |

All dates render in **IST** (`REPORT_TIMEZONE=Asia/Kolkata`, pinned in `setTimezone.ts`). The daily
report covers the **previous** day (always a full 24h, never a future timestamp).

### A2. Status classification (the `S1` sensor)
`S1` reports a numeric trap-status code (`lib/statusClassification.ts`):

| Code | Status | | Code | Status |
|---|---|---|---|---|
| 1 | Normal | | 6 | Choking |
| 2 | Mild Flooding | | 7 | No Status |
| 3 | Heavy Flooding | | 9 | Heavy Leak |
| 4 | Mild Leak | | (8) | *intentionally absent* |
| 5 | Valve Closed | | | |

- **No last reading at all → `Offline`** (device never reported) — distinct from code 7 `No Status`
  (algorithm ran but couldn't classify).
- **Unrecognized code → `No Status`** (with a warning), never silently dropped.
- **Grouping for display:** Mild/Heavy **Flooding** collapse to "Flooding"; Mild/Heavy **Leak** to
  "Leak". The weekly matrix also folds **Valve Closed into "No Status"** (reports but not operating).

### A3. Status durations (the per-status hh:mm:ss)
We don't get durations directly — we derive them from the `S1` time-series:
1. Fetch the window's `S1` readings per device (down-sampled series).
2. **% of readings** in each status = `count(status) / totalReadings` (`deviceTimeSeriesStats.ts`).
   (Assumes roughly uniform sampling — observed ~30 min.)
3. **Duration** = `% × windowHours` rendered as `hh:mm:ss` (`buildDailyAnalysisSheet.formatStatusDuration`).
   e.g. 50% of 24h → `12:00:00`.
- **No readings in the window → the whole window is attributed to `No Status`** (an honest "no data",
  not a fabricated active status), so each row still totals the full 24h.

### A4. Status-change count
`countStatusChanges` = number of times a reading differs from the previous one (time-ordered). Summed
per device over the window. (Across-midnight boundary changes may be ±1 under the cache — negligible.)

### A5. Steam loss / saving (MT)
From a **different** API (`steamConsumptionCustom` on appserver), not the S1 series. Reads
`steamConsumptionTotal` (falls back to summing the per-device `steamConsumption` map, then a legacy
number) and **÷ 1000 → metric tonnes**. `D11` = loss, `D12` = saving.

### A6. Live vs window
- **"Live Status (now)"** and the Live Status sheet use the **last data point** (instantaneous), via
  `getLastDataPoints`. This is *now*, independent of the report-day window.
- Durations / loss / change-counts are for the **report-day window**. So a trap can read "Leak" live
  but show 0 loss for the day (it wasn't leaking during the reported day) — that's expected.

---

## B. Daily report — sheet by sheet (`generateDailyReport.ts`)

One 3-sheet workbook **per unit** (unit = the device's `department:` tag). Data is fetched once for
all devices, then split per unit.

### B1. Summary sheet (`buildDailySummarySheet.ts`)
- **Metadata block:** Plant, Unit, No. of Traps, Period (window), Generation time.
- **Instantaneous status table:** counts each device's **live** status into grouped buckets
  (Normal / Leak / Choked / Flooding / Isolated(=Valve Closed) / No Status / Offline) + a Total row,
  with count and % of the unit's traps.
- **Performance Indicators table — columns DTD | WTD | MTD | YTD**, each computed by `windowValues`:
  - **Trap Health %** = average across the unit's devices of each device's **Normal %** for that window.
  - **Steam Loss (MT)** / **Steam Saving (MT)** = `steamConsumptionTotal` per window.
  - **Status Changes** = Σ device change-counts.
  - **Corrective Actions** = count of CA records whose `dateAndTime` falls in the window.
  - **Feedback** = count of feedback records whose `createdAt` falls in the window.
- **Rate of Steam** is a constant metadata value.

### B2. Analysis sheet (`buildDailyAnalysisSheet.ts`) — one row per device
Columns and their logic:
| Column | Logic |
|---|---|
| Sr No | row index |
| Unit | device `department:` tag (else `Unassigned`) |
| Tag No | device friendly name (`devName`, e.g. "510-HPST-001") |
| **Type of Steam** | `Type Of Steam` metadata (HP/MP/LP/VHP…); `"."` placeholder → `N/A` |
| Device ID | raw `STM_…` id |
| Location | `trapLocation` metadata (else devName) |
| **Live Status (now)** | `classifyStatus(last S1)`, grouped (Flooding/Leak combined) |
| Duration (hrs) | the window length (24h for DTD) |
| Normal / Flooding / Leak / Choking / Valve Closed / No Status / Offline | **time in each status** (A3), hh:mm:ss |
| Change in Status | A4 |
| Number of Corrective Actions | CA records for the device in-window |
| Number of Feedbacks | all-time feedback count for the device |
| Leak Rate (Kg/hr) / Cost of Steam (INR/MT) | device metadata |
| Saving (MT) / Loss (MT) | A5, per device, report-day window |
Rows where the live status ≠ Normal are tinted red.

### B3. Live Status sheet (`buildDailyLiveStatusSheet.ts`) — one row per device
Inlet/Outlet **pressure** + baseline inlet/outlet **temperature** (metadata), **live** inlet/outlet
temperature (last `PT1`/`PT2`), and the classified live **status**. (Temps formatted to 2 dp + °C.)

---

## C. Weekly (Management) report (`generateManagementReport.ts`)
- **One workbook per plant category** (Refinery, Petchem) — always both, even if empty.
- Covers **last full week**; shows WTD / MTD / YTD cumulative KPIs (health, loss/saving, status
  changes, corrective actions) and a **Unit vs Trap Status matrix** (grouped buckets per unit).
- Uses the **same** S1-stats and steam-consumption logic as the daily (A2–A5).
- Devices that don't classify into a category (untagged) are **warned and excluded**, never shipped as
  an "Unassigned" report.

---

## D. Units & plant categories (`lib/plantCategory.ts`)
- A device's **unit** = its `department:<value>` tag. Its **parent category** = `derivePlantCategory`
  (Refinery or Petchem), from a canonical roster + alias normalization (e.g. tag `CDU` → roster
  `CDU/VDU` → Refinery; `DHDT1` → `DHDT-1`). This category drives the weekly grouping and the
  Generate modal's cascading picker.

---

## E. Recipients & scheduling (`config.ts`, `scheduler.ts`, `scheduler/overrides.ts`)
- **Per-unit daily recipients:** `<UNITKEY>_DAILY_RECIPIENTS` (envKey = uppercase, non-alnum→`_`),
  falling back to `DAILY_REPORT_RECIPIENTS`. Weekly: `<CATEGORY>_WEEKLY_RECIPIENTS` → `WEEKLY_REPORT_RECIPIENTS`.
- **Send times** come from `.env` (`DAILY_REPORT_TIME`, `WEEKLY_REPORT_DAY/TIME`), read at boot; a unit
  can have its own `<UNITKEY>_DAILY_TIME`.
- **Runtime overrides** (pause all / pause a section / replace a recipient list) live in
  `logs/report-overrides.txt`, **re-read at fire time** (no restart), **fail-open** (missing/malformed
  → plain `.env` behavior). The admin UI edits this file; `.env` is never mutated from the UI.

---

## F. Reliability & performance logic (`services/iosenseApi.ts`, `services/dailyStatsStore.ts`)
The `S1` history source (`getAutoDownSampledData`) is **flaky and scales badly with devices × range**.
Mitigations, in layers:
1. **Batching** — ≤10 (devID,sensor) pairs per call (lighter = far higher success).
2. **Device-rate pacing** — ≤80 devices / 30s (under IOsense's 100 hard limit), shared across runs.
3. **Per-batch retry** (3×, exp backoff, honoring "Retry after N").
4. **Split-and-retry** — a batch that still fails halves down to single devices, so one bad device
   degrades alone.
5. **Graceful degrade / outage guard** — a device with no data → `No Status`; but if >25% of devices
   fail, abort loudly rather than email a report full of false `No Status`.
6. **Daily-stats cache** (`STATS_CACHE_ENABLED`, default on) — stores one JSON file per IST day of
   per-device status **counts** under `logs/daily-stats/`; WTD/MTD/YTD are the **sum of day-buckets**
   instead of heavy re-sweeps. Only one light 24h fetch per new day (`ensureDaysIngested`); a stored
   day is never re-fetched. Set `STATS_CACHE_ENABLED=false` to revert to live sweeps. Seed with
   `npm run backfill:stats`.

---

## G. Delivery logic (`scheduler.ts`, `fileServer.ts`)
Generate `.xlsx` → save to `OUTPUT_DIR` → **also copy to `ARCHIVE_DIR`** (keepable) → email via IOsense
with the attachment passed **as a URL** (`REPORT_BASE_URL/report/<file>`) → **IOsense fetches that URL**
from our `/report/:fileName` route, which streams then **deletes** the file (one-shot handoff). A send
that fails leaves a pending entry that startup-recovery retries. Every outcome is written to
`logs/report-log.txt` (+ `.jsonl`): `sent | failed | skipped | generation-failed | generated`.
