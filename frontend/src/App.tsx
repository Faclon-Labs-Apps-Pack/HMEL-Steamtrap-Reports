import { useState } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { GenerateViewPage } from './pages/GenerateViewPage';
import { ScheduleReportPage } from './pages/ScheduleReportPage';

// The report-admin app: the "Generate & View" tab (on-demand generation + the send log, merged per
// client request 2026-09-30) and "Schedule Report". The old in-browser viewer pages still exist
// under src/pages/ and can be re-added if ever needed.
type Tab = 'generate-view' | 'schedule';

function App() {
  const [tab, setTab] = useState<Tab>('generate-view');

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
          <TabItem value="generate-view" label="Generate &amp; View" />
          <TabItem value="schedule" label="Schedule Report" />
        </Tabs>
      </div>

      {/* key={tab} remounts on switch so the .ui-page entrance plays each time. */}
      <div className="ui-page" key={tab}>
        {tab === 'generate-view' && <GenerateViewPage />}
        {tab === 'schedule' && <ScheduleReportPage />}
      </div>
    </div>
  );
}

export default App;
