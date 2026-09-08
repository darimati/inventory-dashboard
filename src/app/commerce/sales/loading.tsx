export default function SalesLoading() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">H</div>
          <span className="brand-name">HEEDA</span>
        </div>
        <nav className="sidebar-nav">
          {['대시보드', '매출', '재고', '제품', '정산', '설정'].map((label) => (
            <div key={label} style={{ padding: '10px 12px', borderRadius: 8, color: '#C4CAD1' }}>
              {label}
            </div>
          ))}
        </nav>
      </aside>
      <main className="app-main">
        <div style={{ height: 32, width: 120, background: '#F2F4F7', borderRadius: 8, marginBottom: 14 }} />

        {/* Filter bar skeleton */}
        <div className="global-filter">
          <div className="filter-row">
            <div style={{ height: 33, width: 200, background: '#F2F4F7', borderRadius: 8 }} />
            <div style={{ height: 33, width: 160, background: '#F2F4F7', borderRadius: 8, marginLeft: 'auto' }} />
          </div>
        </div>

        {/* KPI row */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kpi-card" style={{ minHeight: 90 }}>
              <div style={{ height: 12, width: 50, background: '#F2F4F7', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ height: 26, width: 90, background: '#F2F4F7', borderRadius: 6 }} />
            </div>
          ))}
        </div>

        {/* Chart + table */}
        <div className="section" style={{ minHeight: 320, marginBottom: 14 }}>
          <div className="section-header">
            <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
        </div>
        <div className="section" style={{ minHeight: 300 }}>
          <div className="section-header">
            <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
