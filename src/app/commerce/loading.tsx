export default function CommerceLoading() {
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
        {/* Title skeleton */}
        <div style={{ height: 32, width: 200, background: '#F2F4F7', borderRadius: 8, marginBottom: 14 }} />

        {/* KPI row skeleton */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="kpi-card" style={{ minHeight: 100 }}>
              <div style={{ height: 14, width: 60, background: '#F2F4F7', borderRadius: 4, marginBottom: 10 }} />
              <div style={{ height: 28, width: 100, background: '#F2F4F7', borderRadius: 6 }} />
            </div>
          ))}
        </div>

        {/* Check section skeleton */}
        <div className="section" style={{ marginBottom: 14 }}>
          <div className="section-header">
            <div style={{ height: 16, width: 120, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ padding: '16px 20px', borderRight: i < 3 ? '1px solid #F5F7F9' : 'none' }}>
                <div style={{ height: 12, width: 80, background: '#F2F4F7', borderRadius: 4, marginBottom: 8 }} />
                <div style={{ height: 14, width: 140, background: '#F2F4F7', borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Chart + table skeleton */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div className="section" style={{ minHeight: 280 }}>
            <div className="section-header">
              <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
            </div>
          </div>
          <div className="section" style={{ minHeight: 280 }}>
            <div className="section-header">
              <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
