export default function ProductsLoading() {
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

        {/* Product cards skeleton */}
        <div className="product-card-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="product-card" style={{ height: 238, opacity: 0.6 }}>
              <div style={{ height: 18, width: 100, background: '#F2F4F7', borderRadius: 4, marginBottom: 16 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ height: 14, width: 60, background: '#F2F4F7', borderRadius: 4 }} />
                    <div style={{ height: 14, width: 80, background: '#F2F4F7', borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="section" style={{ minHeight: 400 }}>
          <div className="section-header">
            <div style={{ height: 16, width: 100, background: '#F2F4F7', borderRadius: 4 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
