-- inventory_snapshots_coupang: 일별 재고 스냅샷
-- 재고 동기화 후 호출하여 추이 기록
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS inventory_snapshots_coupang (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  product TEXT NOT NULL,
  stock_total INT NOT NULL DEFAULT 0,       -- 로켓그로스 합계
  ezadmin_total INT NOT NULL DEFAULT 0,     -- 국내 3PL 합계
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(snapshot_date, product)
);

-- 조회 성능 인덱스
CREATE INDEX IF NOT EXISTS idx_inv_snap_date ON inventory_snapshots_coupang(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_snap_product ON inventory_snapshots_coupang(product, snapshot_date DESC);

-- RLS
ALTER TABLE inventory_snapshots_coupang ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON inventory_snapshots_coupang
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role all" ON inventory_snapshots_coupang
  FOR ALL TO service_role USING (true) WITH CHECK (true);
