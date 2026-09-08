-- ============================================================
-- HEEDA Influencer Operations — Row Level Security
-- Run AFTER inf_schema.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE inf_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inf_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT (read)
-- CUD operations use supabaseAdmin (service_role) which bypasses RLS

CREATE POLICY "authenticated_select" ON inf_campaigns
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select" ON inf_participants
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select" ON inf_settlements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select" ON inf_access_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select" ON inf_settings
  FOR SELECT TO authenticated USING (true);
