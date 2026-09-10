-- ============================================================
-- HEEDA Influencer Operations — Schema v7 Migration
-- Run in Supabase SQL Editor
-- Changes: skip_consent / skip_draft / skip_edit columns
--          for per-campaign step configuration
-- ============================================================

-- 1. Add skip columns to inf_campaigns
ALTER TABLE inf_campaigns
  ADD COLUMN IF NOT EXISTS skip_consent boolean,
  ADD COLUMN IF NOT EXISTS skip_draft boolean,
  ADD COLUMN IF NOT EXISTS skip_edit boolean;

-- 2. Comments
COMMENT ON COLUMN inf_campaigns.skip_consent IS '동의서 단계 스킵 여부 (null = collab_type 기본값)';
COMMENT ON COLUMN inf_campaigns.skip_draft IS '기획안 단계 스킵 여부 (null = collab_type 기본값)';
COMMENT ON COLUMN inf_campaigns.skip_edit IS '가편집본 단계 스킵 여부 (null = collab_type 기본값)';

-- 3. Set initial values for existing campaigns
-- 2608 무가시딩: all skip
UPDATE inf_campaigns SET skip_consent = true, skip_draft = true, skip_edit = true
  WHERE id = 'eae2fcdb-6845-49e4-8143-7442d602e470';

-- 2609 무가시딩 (free_seeding type campaigns with month 2026-09, skip draft+edit)
UPDATE inf_campaigns SET skip_draft = true, skip_edit = true
  WHERE month = '2026-09' AND collab_type IN ('free_seeding', 'free_collab')
    AND id != 'eae2fcdb-6845-49e4-8143-7442d602e470';

-- 2609 고정고료 (fixed_fee campaigns: no skip — null means default)
-- No update needed: null defaults to false for fixed_fee
