# Steam Trap Reports — Data, Date Ranges & Routes (per generation)

Companion to `report-logic.md`. Covers: the **date ranges** a report uses, **how each DTD/WTD/MTD/YTD
cell is calculated**, the **full routes (with `https://`)** our app and IOsense use, and **how much
data** one report generation fetches (with a worked sample).

---

## 1. Date ranges — what the report expects & covers

**Data exists only from 1-Sep-2026** (`MONITORING_START`) — that's the monitoring start; there is no
data before it. Every cumulative window is anchored to it.

A **daily** report (for report day **D** = the previous completed calendar day) uses four windows:

| Window | Covers | Length (example: report day = 30-Sep-2026) |
|---|---|---|
| **DTD** (the report day) | **D** 00:00:00 → 23:59:59 IST | 1 day |
| **WTD** | the 7 calendar days ending on **D** | 7 days (24–30 Sep) |
| **MTD** | 1st of **D**'s month → **D** | up to 31 days (1–30 Sep) |
| **YTD / "Till Date"** | **1-Sep-2026 → D** (fixed anchor) | grows daily (30 days on 30-Sep; ~1 year max) |

The **weekly** report uses the **last completed week** as its base window, with MTD and YTD computed
the same way (anchored to the week's end). **Max range the system ever requests = YTD** (1-Sep →
yesterday) — this is the heaviest query and grows every day.

All times are **IST** (`Asia/Kolkata`); timestamps sent to IOsense are epoch **milliseconds**.

---

## 2. How each cell (DTD / WTD / MTD / YTD) is calculated

For each window, these are computed **every time a report is generated**:

| Cell / metric | How it's calculated for a window |
|---|---|
| **Trap Health %** | For each device: `% of its S1 readings = Normal` in the window. The cell = **average of that % across the unit's devices**. (A device with no readings counts as 0%.) |
| **Steam Loss (MT)** | `steamConsumptionTotal` for the unit's devices (sensor **D11**) over the window **÷ 1000** → metric tonnes. |
| **Steam Saving (MT)** | Same, sensor **D12** ÷ 1000. |
| **Status Changes** | Σ over the unit's devices of the count of times S1 differs from the previous reading, in the window. |
| **Corrective Actions** | Count of corrective-action records whose `dateAndTime` falls in the window. |
| **Feedback** | Count of feedback records whose `createdAt` falls in the window. |
| **Per-status durations** (Analysis sheet, DTD) | `(% of S1 readings in that status) × window hours`, shown `hh:mm:ss`. No readings → whole window = "No Status". |

**Where the window data comes from (DTD vs WTD/MTD/YTD):**
- **DTD** S1 stats → the report day's readings (one light fetch, or the stored day-bucket if cache on).
- **WTD/MTD/YTD** S1 stats → **CACHE ON (default):** summed from the stored per-day buckets (no live
  long-range fetch). **CACHE OFF:** a live S1 sweep of that whole range.
- Loss/Saving, Corrective Actions, Feedback are always fetched live (CA fetched once over YTD, then
  counted per window client-side; feedback fetched once per device, counted per window).

---

## 3. Routes used in the generation pipeline (full URLs)

### 3a. IOsense APIs we **consume** (`connector` + `appserver`)
| Step | Method + URL | Used for |
|---|---|---|
| Device list | `PUT https://connector.iosense.io/api/account/devices/{skip}/{limit}` | all steam-trap devices (paged, 100/page) |
| Live status + temps | `PUT https://connector.iosense.io/api/account/deviceData/getLastDPsofDevicesAndSensorProcessed` | last S1 / PT1 / PT2 per device (one batched call per sensor-set) |
| **S1 history (stats)** | `PUT https://connector.iosense.io/api/account/widget/getAutoDownSampledData` | status time-series → durations, health, status-changes (**the heavy/flaky one**; ≤10 pairs/call, concurrency 2) |
| Device metadata | `GET https://connector.iosense.io/api/account/ai-sdk/metaData/device/{devID}` | pressure, baseline temps, leak rate, cost, type of steam (1/device, concurrency 10) |
| Corrective actions | `PUT https://appserver.iosense.io/api/account/trapReplacement/filter/{skip}/{limit}` | CA records over YTD (paged, 200/page) |
| Feedback | `PUT https://appserver.iosense.io/api/account/trapReplacement/filter/1/200` | feedback records (1/device, concurrency 10) |
| Steam loss/saving | `PUT https://appserver.iosense.io/api/account/trapReplacement/steamConsumptionCustom` | D11/D12 totals per unit per window |
| Send email | `PUT https://connector.iosense.io/api/account/sendEmail` | email the report (attachment passed as a URL) |

Auth on all of the above: header `Authorization: Bearer <IOSENSE_PAT>` + `organisation: <IOSENSE_ORG_ID>`.

### 3b. Our **own** routes (production base `https://81614037-14de-414e-8f72-dc8810bd47ef-c4d2278f.iocompute.ai`)
| Method + URL | Used for |
|---|---|
| `GET https://81614037-…-c4d2278f.iocompute.ai/report/{fileName}` | IOsense fetches the report file here to attach it, then we delete it |
| `GET  …/api/report-log`, `…/api/archive/{file}` | the log table + re-download sent reports |
| `GET  …/api/sections`, `POST …/api/generate`, `GET …/api/generate/{id}`, `GET …/api/generated/{file}` | on-demand generate + download |
| `GET  …/api/schedules`, `POST …/api/schedules/{key}/pause|resume`, `PUT …/api/schedules/{key}/recipients`, `.../pause-all`, `.../resume-all` | schedule/recipient management |
| `GET/PUT/POST …/api/overrides[/export|/validate]` | the runtime overrides file |
(The test/standalone app exposes the same `/api/*` on its own URL; it has no `/report/*`.)

---

## 4. How much data one report generation fetches — worked sample

**Sample:** daily run, **813 devices**, **20 units** (the live fleet). API calls per step:

| Step | Calls — **CACHE ON** (default) | Calls — **CACHE OFF** (live sweep) |
|---|---|---|
| Device list (100/page) | 9 | 9 |
| Live status + temps (batched) | 2 | 2 |
| S1 history (`getAutoDownSampledData`, 10/call) | **~82** (report day only; WTD/MTD/YTD read from store) | **~328** (82 × 4 windows) |
| Device metadata (1/device) | 813 | 813 |
| Corrective actions (200/page, YTD once) | ~1–5 | ~1–5 |
| Feedback (1/device) | 813 | 813 |
| Steam loss/saving (per unit × windows × 2 sensors) | ~160 | ~160 |
| Email send (1/unit) | 20 | 20 |
| **Total API calls** | **≈ 1,900** | **≈ 2,150** |
| IOsense then fetches each file via `/report/{file}` | 20 | 20 |

**Data volume (S1 points):** `getAutoDownSampledData` returns up to `downscale = 2000` points per
device per window (in practice far fewer — ~43 points/device for a 24h range, ~190 for 30 days).
- **CACHE ON:** only the report day is fetched live (~43 pts × 813 ≈ **35k points**); WTD/MTD/YTD are
  summed from disk (0 fetch).
- **CACHE OFF:** all four windows fetched (~35k + ~250k for WTD + MTD + YTD ≈ **300k+ points**) — which
  is why the heavy sweeps overload the flaky endpoint.

**The key difference:** the cache turns the ~328 heavy S1 calls (and the long-range queries that fail)
into **~82 light one-day calls** — same report, a fraction of the load on the fragile endpoint, and
after the first run of a day even the catch-up is near-zero.

> Numbers are per *full-fleet* run. A per-unit scheduled run fetches proportionally less for the
> per-device steps, but S1 ingestion always covers the full fleet (the store is global).
