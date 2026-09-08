-- ============================================================
-- HEEDA Influencer Operations — Seed Data
-- Run AFTER inf_schema.sql and inf_rls.sql
-- ============================================================

-- 기본 설정값
INSERT INTO inf_settings (key, value) VALUES
  ('consent_advertising', '{"title": "광고 표시 동의서", "body": "본인은 아래 내용을 확인하였으며, 해당 콘텐츠에 광고 표시(유료광고 포함 문구)를 포함하는 것에 동의합니다."}'),
  ('consent_secondary_use', '{"title": "2차 활용 동의서", "body": "본인은 위 콘텐츠를 브랜드의 마케팅 목적으로 2차 활용(자사몰, SNS, 광고 소재 등)하는 것에 동의합니다."}'),
  ('tax_rates', '{"business_3_3": 3.3, "business_8_8": 8.8}'),
  ('default_budget', '{"monthly": 0}')
ON CONFLICT (key) DO NOTHING;
