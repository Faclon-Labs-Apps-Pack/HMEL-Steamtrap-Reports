import { useState } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { SteamTrapStatusPage } from './pages/SteamTrapStatusPage';
import { DeviceDetailReportPage } from './pages/DeviceDetailReportPage';
import { CorrectiveActionLogPage } from './pages/CorrectiveActionLogPage';
import { WeeklyReportPage } from './pages/WeeklyReportPage';
import { DailyReportPage } from './pages/DailyReportPage';

type Tab = 'status' | 'detail' | 'log' | 'weekly' | 'daily';

function App() {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div>
      <div className="global-p-06" style={{ paddingBottom: 0 }}>
        <Tabs value={tab} onChange={(value) => setTab(value as Tab)}>
          <TabItem value="status" label="Steam Trap Status" />
          <TabItem value="detail" label="Device Detail Report" />
          <TabItem value="log" label="Corrective Action Log" />
          <TabItem value="weekly" label="Weekly Report" />
          <TabItem value="daily" label="Daily Report" />
        </Tabs>
      </div>

      {tab === 'status' && <SteamTrapStatusPage />}
      {tab === 'detail' && <DeviceDetailReportPage />}
      {tab === 'log' && <CorrectiveActionLogPage />}
      {tab === 'weekly' && <WeeklyReportPage />}
      {tab === 'daily' && <DailyReportPage />}
    </div>
  );
}

export default App;
