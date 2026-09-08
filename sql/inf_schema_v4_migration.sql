-- ============================================================
-- HEEDA Influencer Operations — Schema v4 Migration
-- Run in Supabase SQL Editor
-- Changes: tax_exempt_invoice support, invoice_status, file upload
-- ============================================================

-- 1. Add tax_exempt_invoice to inf_settlements.tax_type CHECK constraint
ALTER TABLE inf_settlements
  DROP CONSTRAINT IF EXISTS inf_settlements_tax_type_check;

ALTER TABLE inf_settlements
  ADD CONSTRAINT inf_settlements_tax_type_check
  CHECK (tax_type IN ('business_income', 'tax_invoice', 'tax_exempt_invoice', 'simplified_business'));

-- 2. Add invoice_status column for invoice verification tracking (P2-2)
ALTER TABLE inf_settlements
  ADD COLUMN IF NOT EXISTS invoice_status text
  CHECK (invoice_status IN ('pending', 'received', 'verified'));

-- 3. Add tax_rate_snapshot column (P0-4)
ALTER TABLE inf_settlements
  ADD COLUMN IF NOT EXISTS tax_rate_snapshot jsonb;

-- 4. Add biz_reg_file_path column for file upload (P0-3)
ALTER TABLE inf_participants
  ADD COLUMN IF NOT EXISTS biz_reg_file_path text;

-- 5. Create Supabase Storage bucket (run via Dashboard or API)
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('settlement-docs', 'settlement-docs', false, 5242880)
-- ON CONFLICT (id) DO NOTHING;

-- 6. Storage RLS policy — service role only (default for private buckets)
-- No additional RLS needed since all access goes through server-side supabaseAdmin
