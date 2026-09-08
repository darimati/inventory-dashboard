import { supabaseAdmin } from './supabase-server';

interface RateLimitResult {
  allowed: boolean;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
}

/**
 * Login rate limit: 5 failed attempts per IP in 5 minutes.
 * Gracefully allows if login_attempts table doesn't exist.
 */
export async function checkLoginRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { count, error } = await supabaseAdmin
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .eq('success', false)
      .gte('created_at', fiveMinAgo);

    if (error) return { allowed: true };

    const failCount = count ?? 0;

    if (failCount >= 5) {
      return { allowed: false, retryAfterSeconds: 300 };
    }

    return { allowed: true, remainingAttempts: 5 - failCount };
  } catch {
    return { allowed: true };
  }
}

export async function recordLoginAttempt(ip: string, success: boolean): Promise<void> {
  try {
    await supabaseAdmin.from('login_attempts').insert({ ip_address: ip, success });
  } catch {
    // table may not exist yet
  }
}

/**
 * Email code rate limit: 1/min per IP, 5/hour per IP.
 * Gracefully allows if password_reset_codes table doesn't exist.
 */
export async function checkEmailCodeRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count: minCount, error: minErr } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', oneMinAgo);

    if (minErr) return { allowed: true };

    if ((minCount ?? 0) >= 1) {
      return { allowed: false, retryAfterSeconds: 60 };
    }

    const { count: hourCount } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', oneHourAgo);

    if ((hourCount ?? 0) >= 5) {
      return { allowed: false, retryAfterSeconds: 3600 };
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
