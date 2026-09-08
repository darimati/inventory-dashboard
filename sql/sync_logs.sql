-- sync_logs: track each sync run (cron or manual)
CREATE TABLE IF NOT EXISTS sync_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type  text NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  fetched_count integer DEFAULT 0,
  inserted_count integer DEFAULT 0,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status, started_at DESC);
