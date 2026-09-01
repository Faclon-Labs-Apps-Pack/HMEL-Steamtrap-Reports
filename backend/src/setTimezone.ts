// Force the Node process to run in the report timezone (IST by default) so every Date the reports
// render — "Generation Time", "Period", "Status at ..." — and the daily/weekly data windows are all
// in the team's local time. Host VMs commonly boot in UTC; without this, a report generated at
// 12:15 IST prints "06:45" (UTC) and the daily/weekly windows align to UTC midnight instead of IST.
//
// This must be the FIRST import in every entry point, so TZ is set before any Date is created.
// Cron FIRING already uses REPORT_TIMEZONE explicitly (see scheduleReport), so this does NOT change
// when reports run — only how their dates render and which calendar day the data window covers.
process.env.TZ = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
