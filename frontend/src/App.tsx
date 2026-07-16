import { useState } from 'react';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { SteamTrapStatusPage } from './pages/SteamTrapStatusPage';
import { DeviceDetailReportPage } from './pages/DeviceDetailReportPage';
import { CorrectiveActionLogPage } from './pages/CorrectiveActionLogPage';

type Tab = 'status' | 'detail' | 'log';

function App() {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div>
      <div className="global-p-06" style={{ paddingBottom: 0 }}>
        <Tabs value={tab} onChange={(value) => setTab(value as Tab)}>
          <TabItem value="status" label="Steam Trap Status" />
          <TabItem value="detail" label="Device Detail Report" />
          <TabItem value="log" label="Corrective Action Log" />
        </Tabs>
      </div>

      {tab === 'status' && <SteamTrapStatusPage />}
      {tab === 'detail' && <DeviceDetailReportPage />}
      {tab === 'log' && <CorrectiveActionLogPage />}
    </div>
  );
}

export default App;
