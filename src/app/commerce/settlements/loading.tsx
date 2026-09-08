export default function SettlementsLoading() {
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

        {/* KPI row */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kpi-card" style={{ minHeight: 90 }}>
              <div style={{ height: 12, width: 60, background: '#F2F4F7', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ height: 26, width: 100, background: '#F2F4F7', borderRadius: 6 }} />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="section" style={{ minHeight: 400 }}>
          <div className="section-header">
            <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
          <div style={{ padding: '0' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, padding: '13px 20px', borderBottom: '1px solid #F5F7F9' }}>
                <div style={{ height: 14, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 14, width: 80, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 14, width: 60, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 14, width: 80, background: '#F2F4F7', borderRadius: 4, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
