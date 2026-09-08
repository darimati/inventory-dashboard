-- ═══════════════════════════════════════════════════════════════
-- HEEDA Auth Schema v5 — Dashboard Access Protection
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- app_settings: single-row auth configuration
CREATE TABLE IF NOT EXISTS app_settings (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash    text,
  admin_email      text,
  session_version  integer NOT NULL DEFAULT 1,
  setup_completed  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- password_reset_codes: email verification codes
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash    text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('password_change', 'password_reset')),
  ip_address   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prc_ip ON password_reset_codes(ip_address, created_at DESC);

-- login_attempts: rate limiting
CREATE TABLE IF NOT EXISTS login_attempts (
  id           serial PRIMARY KEY,
  ip_address   text NOT NULL,
  success      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_la_ip ON login_attempts(ip_address, created_at DESC);

-- settings_history: audit log
CREATE TABLE IF NOT EXISTS settings_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  actor_ip     text,
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sh_action ON settings_history(action, created_at DESC);

-- Future-proof: nullable user_id columns
ALTER TABLE inf_campaigns ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE inf_participants ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE inf_settlements ADD COLUMN IF NOT EXISTS user_id text;

-- Cleanup hint (run periodically):
-- DELETE FROM login_attempts WHERE created_at < now() - interval '7 days';
-- DELETE FROM password_reset_codes WHERE expires_at < now() - interval '1 day';
