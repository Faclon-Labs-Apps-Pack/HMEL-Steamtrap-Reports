# Steam Trap Reports — Plain-English Guide to the Routes

A "route" is just a web address the app answers on — like a counter at an office, each one handles one
kind of request. This guide lists every route in everyday language: **what it does** and **where you
see it** in the reports or the dashboard. (Technical version: `report-routes.md`.)

## The big picture

The system does two things:
1. **Sends steam-trap reports by email** — on a daily/weekly schedule, one report per plant unit.
2. **Gives you a dashboard** to generate reports on demand, see what was sent, and manage schedules.

There are **two copies** of the app:
- **Live app** — the real one that emails reports and serves the dashboard to everyone.
- **Test app** — an identical dashboard for trying things safely; it **never sends email**.

---

## 1. Sending a report by email

| Route | In plain words | Where you see it |
|---|---|---|
| `GET /report/<file>` | When a report is emailed, the email system **picks up the finished Excel file** from here and attaches it. The file is handed over once, then removed. | Behind the scenes, every time a report email goes out. The Excel file attached to your email came through here. |

---

## 2. The dashboard — "Generate & View" tab

| Route | In plain words | Where you see it |
|---|---|---|
| `GET /api/sections` | The **list of plants/units** you can choose from (Refinery units, Petchem units). | The "Plant" and unit checkboxes in the **Generate** popup. |
| `POST /api/generate` | **"Build me a report"** for the units and date range you picked. | The **Generate** button. |
| `GET /api/generate/<id>` | **"How's it going?"** — checks progress of the report being built. | The progress/spinner while a report generates. |
| `GET /api/generated/<file>` | **Download a report you just generated** on demand. | The download link for an on-demand report. |
| `GET /api/report-log` | The **full history** of reports — what was generated/sent, to whom, success or failure. | The **"Report Logs"** table. |
| `GET /api/archive/<file>` | **Download a copy** of a report that was already emailed. | The **download (⬇) icon** in the Report Logs table. |

---

## 3. The dashboard — "Schedule Report" tab

| Route | In plain words | Where you see it |
|---|---|---|
| `GET /api/schedules` | The **list of all scheduled reports** — which unit, send time, who receives it, active or paused. | The **Schedule** tab table. |
| `POST /api/schedules/pause-all` | **Pause every report** (stop all sending). | "Pause all" button. |
| `POST /api/schedules/resume-all` | **Resume every report.** | "Resume all" button. |
| `POST /api/schedules/<unit>/pause` | **Pause one unit's** report. | The Pause button on a row. |
| `POST /api/schedules/<unit>/resume` | **Resume one unit's** report. | The Resume button on a row. |
| `PUT /api/schedules/<unit>/recipients` | **Change who receives** a unit's report (add/remove emails). | "Edit recipients" on a row. |
| `GET /api/overrides` | Shows the current **settings file** of pauses + recipient changes. | Behind the Schedule tab. |
| `GET /api/overrides/export` | **Download that settings file** (to edit in Notepad). | "Export" button. |
| `POST /api/overrides/validate` | **Preview** what an edited settings file would change — before applying. | The preview shown when you import a file. |
| `PUT /api/overrides` | **Apply** an edited settings file. | "Import/Apply" button. |

> Note: schedule changes here take effect on the **next** scheduled run and never disturb the running
> system — send *times* themselves are fixed in the server settings.

---

## 4. Behind the scenes

| Route | In plain words | Where you see it |
|---|---|---|
| `GET /api/health` | A simple **"are you alive?"** check for the service. | Not visible — used for monitoring. |
| The dashboard web page | Serves the **dashboard screens** themselves. | Everything you see when you open the app URL. |

---

## How it all fits together (one report's journey)
1. The schedule fires (or you click **Generate**) → `POST /api/generate` builds the Excel report.
2. The app keeps a copy and emails it; the email system fetches the file via `GET /report/<file>`.
3. The result is recorded and shows up in **Report Logs** (`GET /api/report-log`), where you can
   **download** it again (`GET /api/archive/<file>`).
4. You can **pause/resume** or **change recipients** anytime from the **Schedule** tab.
