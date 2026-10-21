import { useState } from 'react';
import { GenerateReportPage } from './pages/GenerateReportPage';
import { ViewReportsPage } from './pages/ViewReportsPage';
import { ScheduleReportPage } from './pages/ScheduleReportPage';
import { AuthGate } from './components/AuthGate';
import type { Me } from './auth/session';

// The report-admin app, gated by IOsense sub-user roles (2026-10-19): admins (main accounts)
// get all three tabs; scoped read users get ONLY View Reports, server-filtered to their
// sections. Tabs are plain accessible buttons with a sliding brand-blue underline.
type Tab = 'generate' | 'view-reports' | 'schedule';

const ALL_TABS: { id: Tab; label: string }[] = [
  { id: 'generate', label: 'Generate Report' },
  { id: 'view-reports', label: 'View Reports' },
  { id: 'schedule', label: 'Schedule Reports' },
];

function Shell({ me }: { me: Me }) {
  const isAdmin = me.access.kind === 'admin';
  const tabs = isAdmin ? ALL_TABS : ALL_TABS.filter((t) => t.id === 'view-reports');
  const [tab, setTab] = useState<Tab>(isAdmin ? 'generate' : 'view-reports');

  return (
    <main className="ui-main ui-main--fill">
      {/* Session bar removed per client request 2026-10-19 — SessionBar in AuthGate.tsx can be
          re-added here if identity/logout ever needs to be visible again. */}
      <nav className="ui-tabs ui-tabs--light" role="tablist" aria-label="Report sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'is-active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* key={tab} remounts on switch so the .ui-page entrance plays each time. */}
      <div className="ui-page ui-panel" key={tab}>
        {tab === 'generate' && isAdmin && <GenerateReportPage />}
        {tab === 'view-reports' && <ViewReportsPage scopeLabel={isAdmin ? undefined : me.accessLabel} />}
        {tab === 'schedule' && isAdmin && <ScheduleReportPage />}
      </div>
    </main>
  );
}

function App() {
  return <AuthGate>{(me) => <Shell me={me} />}</AuthGate>;
}

export default App;
