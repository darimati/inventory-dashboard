-- ============================================================
-- HEEDA Influencer Operations — Schema v2
-- Run in Supabase SQL Editor (순서대로)
-- ============================================================

-- 0. 기존 테이블 삭제 (첫 설치 시)
DROP TABLE IF EXISTS inf_access_logs CASCADE;
DROP TABLE IF EXISTS inf_settlements CASCADE;
DROP TABLE IF EXISTS inf_participants CASCADE;
DROP TABLE IF EXISTS inf_campaigns CASCADE;
DROP TABLE IF EXISTS inf_settings CASCADE;

-- 1. 캠페인
CREATE TABLE inf_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  month text,
  collab_type text NOT NULL DEFAULT 'free_seeding'
    CHECK (collab_type IN ('free_seeding','free_collab','fixed_fee','fixed_fee_rs')),
  budget numeric DEFAULT 0,
  target_product text,
  manager text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','cancelled')),
  memo text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inf_campaigns_status ON inf_campaigns(status);

-- 2. 참여자
CREATE TABLE inf_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES inf_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_name text,
  channel text CHECK (channel IN ('instagram','youtube','tiktok','blog','other')),
  handle text,
  profile_url text,
  follower_count int,
  product text,
  product_quantity int DEFAULT 1,
  product_cost numeric DEFAULT 0,
  fee numeric DEFAULT 0,
  post_type text,
  post_count int DEFAULT 1,
  content_deadline date,
  publish_deadline date,
  secondary_use boolean DEFAULT false,
  secondary_use_period text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','product_sent','content_submitted','published','completed','cancelled')),
  -- 동의서
  consent_status text NOT NULL DEFAULT 'not_sent'
    CHECK (consent_status IN ('not_sent','sent','agreed','expired')),
  consent_token text UNIQUE,
  consent_token_expires_at timestamptz,
  consent_agreed_at timestamptz,
  consent_ip text,
  -- 동의서에서 인플루언서가 입력
  phone text,
  planned_draft_date date,
  planned_edit_date date,
  planned_upload_date date,
  delivery_name text,
  delivery_phone text,
  delivery_address text,
  -- 정산서
  settlement_status text NOT NULL DEFAULT 'none'
    CHECK (settlement_status IN ('none','docs_requested','docs_submitted','payment_requested','paid','expired')),
  settlement_token text UNIQUE,
  settlement_token_expires_at timestamptz,
  -- PII (암호화 저장)
  real_name_enc bytea,
  ssn_enc bytea,
  business_name text,
  business_reg_enc bytea,
  bank_name text,
  bank_account_enc bytea,
  bank_holder text,
  -- 퍼포먼스
  published_url text,
  views int,
  likes int,
  comments int,
  engagement_rate numeric,
  memo text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inf_participants_campaign ON inf_participants(campaign_id);
CREATE INDEX idx_inf_participants_status ON inf_participants(status);
CREATE INDEX idx_inf_participants_consent_token ON inf_participants(consent_token);
CREATE INDEX idx_inf_participants_settlement_token ON inf_participants(settlement_token);

-- 3. 정산
CREATE TABLE inf_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES inf_participants(id) ON DELETE CASCADE,
  gross_amount numeric NOT NULL,
  tax_type text CHECK (tax_type IN ('business_income','tax_invoice','simplified_business')),
  tax_rate numeric,
  tax_amount numeric,
  net_amount numeric,
  payment_status text NOT NULL DEFAULT 'waiting'
    CHECK (payment_status IN ('waiting','requested','paid','on_hold')),
  planned_date date,
  paid_date date,
  upload_link text,
  memo text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inf_settlements_participant ON inf_settlements(participant_id);
CREATE INDEX idx_inf_settlements_status ON inf_settlements(payment_status);

-- 4. PII 접근 로그
CREATE TABLE inf_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text,
  participant_id uuid NOT NULL REFERENCES inf_participants(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  action text NOT NULL,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inf_access_logs_participant ON inf_access_logs(participant_id);

-- 5. 운영 설정
CREATE TABLE inf_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inf_campaigns_updated BEFORE UPDATE ON inf_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inf_participants_updated BEFORE UPDATE ON inf_participants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inf_settlements_updated BEFORE UPDATE ON inf_settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inf_settings_updated BEFORE UPDATE ON inf_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. RLS
ALTER TABLE inf_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_settings ENABLE ROW LEVEL SECURITY;

-- service_role은 RLS를 bypass하므로 별도 정책 불필요

-- 7. 기본 설정 시드
INSERT INTO inf_settings (key, value) VALUES
  ('consent_advertising', '{"title":"광고 표시 동의서","body":"본 광고는 업체로부터 제품/대가를 제공받아 작성되었으며, 공정거래위원회의 추천·보증 등에 관한 표시·광고 심사지침에 따라 광고임을 표시합니다."}'),
  ('consent_secondary_use', '{"title":"2차 활용 동의서","body":"촬영된 콘텐츠(사진, 영상, 텍스트 등)를 브랜드 자사몰, SNS, 광고 소재 등 마케팅 목적으로 2차 활용하는 것에 동의합니다."}'),
  ('tax_rates', '{"business_income":3.3,"tax_invoice":0,"simplified_business":0}'),
  ('default_budget', '{"monthly":0}'),
  ('settlement_guidance', '{"input_notice":"- 주민등록번호는 13자리, 사업자등록번호는 10자리 숫자만 입력\n- 사업소득 선택 시 실명, 세금계산서/간이사업자 선택 시 사업자명 필수\n- 간이사업자(면세사업자)는 부가세가 발생하지 않습니다\n- 하이픈(-), 공백, 특수문자는 자동으로 제거됩니다\n- 제출 후 수정이 어려우니 신중히 입력해주세요","settlement_notice":"정산은 매월 가까운 15일에 진행되며, 사업자인 경우 별도로\n세금계산서 발행 안내를 드리고 있습니다. (휴일인 경우 전일 진행)"}')
ON CONFLICT (key) DO NOTHING;
