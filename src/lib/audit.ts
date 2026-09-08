import { supabaseAdmin } from './supabase-server';

type AuditAction = 'login' | 'login_failed' | 'logout' | 'password_change' | 'setup' | 'recovery';

export async function logAudit(
  action: AuditAction,
  ip: string,
  detail?: string,
): Promise<void> {
  try {
    await supabaseAdmin.from('settings_history').insert({
      action,
      actor_ip: ip,
      detail: detail ?? null,
    });
  } catch {
    // settings_history table may not exist yet
  }
}
