-- Performance indexes for heavily-queried tables
-- Supabase SQL Editor에서 실행

-- sales_coupang: 매출 조회 최적화 (가장 많이 사용되는 테이블)
-- 기본 필터: brand + country + sale_date 범위
CREATE INDEX IF NOT EXISTS idx_sales_coupang_brand_country_date
  ON sales_coupang(brand, country, sale_date);

-- vendor_item_id 조회 (재고 매핑, 상품명 조회)
CREATE INDEX IF NOT EXISTS idx_sales_coupang_vendor_item_id
  ON sales_coupang(vendor_item_id);

-- sale_type 필터 (SALE 필터링)
CREATE INDEX IF NOT EXISTS idx_sales_coupang_sale_type
  ON sales_coupang(sale_type);

-- inventory_coupang: 재고 조회 최적화
CREATE INDEX IF NOT EXISTS idx_inventory_coupang_vendor_item_id
  ON inventory_coupang(vendor_item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_coupang_stock
  ON inventory_coupang(total_orderable_quantity DESC);

-- ezadmin_inventory: 3PL 재고 조회 최적화
CREATE INDEX IF NOT EXISTS idx_ezadmin_inventory_product_code
  ON ezadmin_inventory(product_code);

CREATE INDEX IF NOT EXISTS idx_ezadmin_inventory_stock
  ON ezadmin_inventory(available_stock DESC);

-- sync_logs: 동기화 이력 조회 최적화
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at
  ON sync_logs(started_at DESC);

-- promotions_coupang: 프로모션 조회 최적화
CREATE INDEX IF NOT EXISTS idx_promotions_is_active_dates
  ON promotions_coupang(is_active, start_date, end_date);
