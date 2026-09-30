import { useState } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { GenerateReportPage } from './pages/GenerateReportPage';
import { ScheduleReportPage } from './pages/ScheduleReportPage';
import { ViewReportsPage } from './pages/ViewReportsPage';

// The report-admin app: only the three operations tabs. The old in-browser viewer pages
// (Steam Trap Status, Device Detail, Corrective Action Log, Weekly/Daily Report) still exist
// under src/pages/ and can be re-added here if ever needed — per client request (2026-09-30)
// they are not shown.
type Tab = 'generate' | 'schedule' | 'view-reports';

function App() {
  const [tab, setTab] = useState<Tab>('generate');

  return (
    <div>
      <div className="global-p-06" style={{ paddingBottom: 0 }}>
        <header className="ui-app-header">
          <h1 className="HeadingSmallSemibold ui-app-title">Steam Trap Reports</h1>
          <p className="BodySmallRegular ui-app-subtitle">
            HMEL — generate, schedule and review steam-trap reports.
          </p>
        </header>
        <Tabs value={tab} onChange={(value) => setTab(value as Tab)}>
          <TabItem value="generate" label="Generate Report" />
          <TabItem value="schedule" label="Schedule Report" />
          <TabItem value="view-reports" label="View Reports" />
        </Tabs>
      </div>

      {/* key={tab} remounts on switch so the .ui-page entrance plays each time. */}
      <div className="ui-page" key={tab}>
        {tab === 'generate' && <GenerateReportPage />}
        {tab === 'schedule' && <ScheduleReportPage />}
        {tab === 'view-reports' && <ViewReportsPage />}
      </div>
    </div>
  );
}

export default App;
