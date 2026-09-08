export default function SettingsLoading() {
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
        <div style={{ height: 32, width: 100, background: '#F2F4F7', borderRadius: 8, marginBottom: 14 }} />

        {/* Settings sections skeleton */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="section" style={{ marginBottom: 14, minHeight: 120 }}>
            <div className="section-header">
              <div style={{ height: 16, width: 120, background: '#F2F4F7', borderRadius: 4 }} />
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ height: 14, width: 80, background: '#F2F4F7', borderRadius: 4 }} />
                <div style={{ height: 36, width: 200, background: '#F2F4F7', borderRadius: 8 }} />
              </div>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
