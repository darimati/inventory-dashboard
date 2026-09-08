-- ============================================================
-- HEEDA Influencer Operations — Schema v6 Migration
-- Run in Supabase SQL Editor
-- Changes: draft_link, edit_link columns for content submission tracking
-- ============================================================

-- 1. Add draft_link and edit_link columns
ALTER TABLE inf_participants
  ADD COLUMN IF NOT EXISTS draft_link text,
  ADD COLUMN IF NOT EXISTS edit_link text;

-- 2. Add comments for documentation
COMMENT ON COLUMN inf_participants.draft_link IS '기획안 제출 링크 (Google Docs 등)';
COMMENT ON COLUMN inf_participants.edit_link IS '가편집본 제출 링크 (Google Docs 등)';
