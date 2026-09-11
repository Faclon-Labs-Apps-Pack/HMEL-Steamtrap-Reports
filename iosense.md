# IOsense APIs used by the Steam-Trap Reports

This documents every IOsense API the report generator calls, what each is for, and which part of
the report it feeds. All calls are made from the backend (`backend/src/services/*`).

## Hosts & auth
| Host | Base | Used for |
|---|---|---|
| **Connector** | `https://connector.iosense.io/api` | devices, live data, time-series, device metadata |
| **App server** | `https://appserver.iosense.io/api` | trap-replacement app: steam consumption, corrective actions, feedback |

**Auth headers (every request):**
- `Authorization: Bearer <IOSENSE_PAT>` — Personal Access Token (from `.env`; must be a single clean `Bearer …`, no quotes)
- `organisation: <IOSENSE_ORG_ID>`
- `Content-Type: application/json`, `ngsw-bypass: true`

**Sensors referenced:** `S1` = trap status · `PT1` = inlet temperature · `PT2` = outlet temperature · `D11` = steam-loss value · `D12` = steam-saving value.

---

## 1. Find Devices
- **Endpoint:** `PUT /account/devices/{skip}/{limit}` (Connector)
- **Code:** `findDevicesByType()` — `iosenseApi.ts`
- **Body:** `{ search: { devTypeName: ["steam trap"] }, filter: [], order, sort }` (paginated)
- **Returns:** every steam-trap device (`devID`, `devName`, `tags`, …)
- **Used for:** the device roster for **all** reports; the `department:` tag on each device is the unit/plant grouping.

## 2. Get Last Data Points
- **Endpoint:** `PUT /account/deviceData/getLastDPsofDevicesAndSensorProcessed` (Connector)
- **Code:** `getLastDataPoints()` — `iosenseApi.ts`
- **Body:** list of `{ devID, sensor }`
- **Returns:** the **latest / current** value per (device, sensor)
- **Used for:** **current trap status** (S1) → Summary status counts + Live Status sheet; **live inlet/outlet temperatures** (PT1/PT2) → Live Status sheet. This is the "live" data (as of generation time), not windowed.

## 3. Get Auto-DownSampled Data (time-series)
- **Endpoint:** `PUT /account/widget/getAutoDownSampledData` (Connector)
- **Code:** `getBulkDeviceTimeSeries()` → `getTimeSeriesStatsByDevice()` — `iosenseApi.ts` / `deviceTimeSeriesStats.ts`
- **Body:** `{ devConfig: [{ devID, sensor, sTime, eTime, downscale }] }`
- **Returns:** downsampled S1 time-series over the window
- **Used for:** **status history analysis** → Analysis sheet (time-spent-in-each-status hh:mm:ss), status-change count, and trap-health % (WTD/MTD/YTD).
- ⚠️ **Rate-limited:** IOsense caps this at **100 devices / 30-second** rolling window. We self-throttle to **80** (batches of 20, concurrency 2) so we never trip it. 30s request timeout + retry per batch.

## 4. Device Metadata
- **Endpoint:** `GET /account/ai-sdk/metaData/device/{devID}` (Connector)
- **Code:** `getDeviceMetadata()` → `getDevicePropertiesByDevice()` — `iosenseApi.ts` / `devicePropertiesApi.ts`
- **Returns:** per-device property list (`propertyName` / `propertyValue`)
- **Used for (report columns):** **Type of Steam** (`Type Of Steam` → HP/MP/LP/VHP), **Location** (`Trap Location`), **Inlet/Outlet Pressure**, **Inlet/Outlet Baseline Temperature**, **Leak Rate** (`Steam Leak`), **Cost of Steam** (`costOfSteam`).
- One call per device (concurrency-limited, 10 in flight — no bulk metadata endpoint).

## 5. Steam Consumption (loss / saving)
- **Endpoint:** `PUT /account/trapReplacement/steamConsumptionCustom` (App server)
- **Code:** `getSteamConsumptionTotal()` / `getSteamLossByDevice()` / `getSteamSavingByDevice()` — `steamConsumptionApi.ts`
- **Body:** `{ devices: [{ devID, sensorId }], startTime, endTime, timezone: "Asia/Kolkata" }` — sensorId `D11` for loss, `D12` for saving
- **Returns:** `{ steamConsumption: { <devID>: <kg> }, steamConsumptionTotal: <kg>, … }` — **KG** (we ÷1000 → **MT**)
  - ⚠️ Read **`steamConsumptionTotal`** (the aggregate). The `steamConsumption` field is an object keyed by devID; reading it as a plain number made every value 0 (fixed 2026-09-03).
- **Used for:** **Steam Loss (MT)** and **Steam Savings (MT)** per device (Analysis) and totals (Summary), plus **Loss/Savings (INR)** = MT × cost-of-steam, and the Weekly Performance Indicators.

## 6. Corrective Actions
- **Endpoint:** `PUT /account/trapReplacement/filter/{skip}/{limit}` (App server)
- **Code:** `getCorrectiveActions()` — `correctiveActionApi.ts`
- **Body:** device/eventType/time filter (paginated)
- **Returns:** corrective-action records (with timestamps per device)
- **Used for:** **Number of Corrective Actions** per device/window → Daily Analysis + Weekly Corrective Action table (WTD/MTD/YTD).

## 7. Feedback
- **Endpoint:** `PUT /account/trapReplacement/filter/1/200` (App server)
- **Code:** `getFeedbackDatesByDevice()` / `getFeedbackCountsByDevice()` — `feedbackApi.ts`
- **Returns:** feedback records per device
- **Used for:** **Number of Feedbacks** per device/window → Daily Analysis sheet.

---

## Report section → API map (quick reference)
| Report piece | API(s) |
|---|---|
| Device list / units | 1 Find Devices |
| Current status, live temps | 2 Last Data Points |
| Status-time analysis, trap health, status changes | 3 Auto-DownSampled |
| Type of Steam, Location, pressures, baseline temps, leak rate, cost | 4 Device Metadata |
| Steam Loss / Savings (MT & INR) | 5 Steam Consumption |
| Corrective Actions | 6 Trap Replacement Filter |
| Feedbacks | 7 Trap Replacement Filter |

## Windows (what period each report covers)
- **Daily** report = the **previous full calendar day** (00:00→23:59:59 IST). Live status/temps are current (generation time).
- **Weekly** report = the **last completed week** (Mon→Sun), plus WTD/MTD/YTD columns in Performance Indicators.
- **WTD** = trailing 7 days · **MTD** = since the 1st of the month · **YTD / Till Date** = cumulative since a **fixed 1-Sep-2026** (`MONITORING_START` in `dateRange.ts`) — data only exists from that date, so this replaced the Apr-Mar financial year.
- All times render in **IST** (`REPORT_TIMEZONE`, default `Asia/Kolkata`).
