export default function InventoryLoading() {
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
        <div style={{ height: 32, width: 160, background: '#F2F4F7', borderRadius: 8, marginBottom: 14 }} />

        {/* Summary KPI row */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kpi-card" style={{ minHeight: 80 }}>
              <div style={{ height: 12, width: 50, background: '#F2F4F7', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ height: 24, width: 70, background: '#F2F4F7', borderRadius: 6 }} />
            </div>
          ))}
        </div>

        {/* Tab bar skeleton */}
        <div style={{ display: 'flex', gap: 4, padding: '3px', background: '#F1F3F6', borderRadius: 9, width: 'fit-content', marginBottom: 14 }}>
          {['로켓그로스', '이지어드민', '추이', '발주 관리'].map((label) => (
            <div key={label} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, color: '#C4CAD1' }}>{label}</div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="section">
          <div className="section-header">
            <div style={{ height: 16, width: 140, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
          <div style={{ padding: '0' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, padding: '13px 20px', borderBottom: '1px solid #F5F7F9' }}>
                <div style={{ height: 14, width: 120, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 14, width: 80, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 14, width: 60, background: '#F2F4F7', borderRadius: 4, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
