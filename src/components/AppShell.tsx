'use client';

import { Suspense, useState } from 'react';
import Sidebar from './Sidebar';
import GlobalFilter from './GlobalFilter';

export default function AppShell({ children, showFilter = true }: { children: React.ReactNode; showFilter?: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <Suspense fallback={null}>
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </Suspense>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mobile-header">
          <button onClick={() => setSidebarOpen(true)}>&#9776;</button>
          <span className="brand">HEEDA</span>
        </div>
        <main className="app-main">
          {showFilter && (
            <Suspense fallback={null}>
              <GlobalFilter />
            </Suspense>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
