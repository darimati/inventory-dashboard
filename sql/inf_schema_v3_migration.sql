-- ============================================================
-- HEEDA Influencer Operations — Schema v3 Migration
-- Run in Supabase SQL Editor (idempotent)
-- ============================================================

-- 1. Campaign: add 'preparing' status
ALTER TABLE inf_campaigns DROP CONSTRAINT IF EXISTS inf_campaigns_status_check;
ALTER TABLE inf_campaigns ADD CONSTRAINT inf_campaigns_status_check
  CHECK (status IN ('preparing','active','completed','cancelled'));

-- 2. Campaign: add advertised_products column
ALTER TABLE inf_campaigns ADD COLUMN IF NOT EXISTS advertised_products jsonb DEFAULT '[]';

-- 3. Participant: collab_type (moved from campaign level)
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS collab_type text
  CHECK (collab_type IS NULL OR collab_type IN ('free_seeding','free_collab','fixed_fee','fixed_fee_rs'));

-- 4. Participant: provided products & set
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS provided_products jsonb DEFAULT '[]';
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS product_set_name text;

-- 5. Participant: content formats
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS content_formats jsonb DEFAULT '[]';

-- 6. Participant: address split
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS delivery_postal_code text;
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS delivery_address_base text;
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS delivery_address_detail text;

-- 7. Participant: RS ratio
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS rs_ratio numeric;

-- 8. Migrate collab_type from campaign to existing participants
UPDATE inf_participants p
SET collab_type = c.collab_type
FROM inf_campaigns c
WHERE p.campaign_id = c.id
  AND p.collab_type IS NULL;

-- 9. New settings seeds
INSERT INTO inf_settings (key, value) VALUES
  ('consent_privacy', '{
    "title": "개인정보 수집 및 이용 동의",
    "body": "제공받는 자: (주)마야크루\n이용 목적: 제품 배송, 콘텐츠 성과 확인, 광고 금액 지급\n제공 항목: 이름, 연락처, 주소\n보유 및 이용기간: 지급 완료일로부터 6개월까지. 협업 중단 또는 지급이 불필요한 경우 입력일로부터 6개월까지."
  }'),
  ('influencer_products', '{
    "products": [
      {"name": "클렌징밤", "unit_cost": 4500},
      {"name": "클렌징폼", "unit_cost": 3800},
      {"name": "세럼", "unit_cost": 6200}
    ]
  }'),
  ('influencer_product_sets', '{
    "sets": [
      {
        "name": "3종 세트",
        "items": [
          {"product": "클렌징밤", "quantity": 1},
          {"product": "클렌징폼", "quantity": 1},
          {"product": "세럼", "quantity": 1}
        ]
      }
    ]
  }'),
  ('consent_progress_conditions', '{
    "conditions": [
      {"text": "업로드한 콘텐츠는 6개월 이상 유지해주세요.", "paid_only": false},
      {"text": "제작 전 기획안, 업로드 전 콘텐츠·썸네일·캡션을 확인 후 업로드해주세요.", "paid_only": false},
      {"text": "협의된 전달 일정이 지켜지지 않는 경우 진행이 취소될 수 있습니다.", "paid_only": false},
      {"text": "원고료는 콘텐츠 업로드 후 가까운 15일에 입금됩니다.", "paid_only": true}
    ]
  }'),
  ('annual_budget', '{"amount": 5000000}')
ON CONFLICT (key) DO NOTHING;
