-- promotions_coupang: 쿠폰/프로모션 기간 관리
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS promotions_coupang (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  product TEXT,                          -- null = 전체 상품
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  discount_rate NUMERIC(5,2) NOT NULL,   -- % (예: 20.00)
  memo TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE promotions_coupang ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON promotions_coupang
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role all" ON promotions_coupang
  FOR ALL TO service_role USING (true) WITH CHECK (true);
