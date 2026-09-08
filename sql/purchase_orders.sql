-- purchase_orders & purchase_order_items: 발주·입고 관리
-- Supabase SQL Editor에서 실행

-- 기존 테이블 삭제 (초기 설정)
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;

-- 발주 마스터
CREATE TABLE purchase_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL CHECK (order_type IN ('production', 'transfer')),
  destination TEXT NOT NULL CHECK (destination IN ('easyadmin', 'rocketgrowth')),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'arrived', 'cancelled')),
  ordered_at DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_at DATE,
  arrived_at TIMESTAMPTZ,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- 발주 품목
CREATE TABLE purchase_order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  arrived_quantity INT NOT NULL DEFAULT 0 CHECK (arrived_quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 조회 성능 인덱스
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_expected ON purchase_orders(expected_at);
CREATE INDEX idx_po_created ON purchase_orders(created_at DESC);
CREATE INDEX idx_poi_order_id ON purchase_order_items(purchase_order_id);

-- RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read po" ON purchase_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role all po" ON purchase_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated read poi" ON purchase_order_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role all poi" ON purchase_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
