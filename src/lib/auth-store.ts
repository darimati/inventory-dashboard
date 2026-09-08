import { supabaseAdmin } from './supabase-server';

export interface AuthConfig {
  password_hash: string | null;
  admin_email: string | null;
  session_version: number;
  setup_completed: boolean;
}

const AUTH_CONFIG_KEY = 'auth_config';
const DEFAULT_CONFIG: AuthConfig = {
  password_hash: null,
  admin_email: null,
  session_version: 1,
  setup_completed: false,
};

/**
 * inf_settings 테이블에서 인증 설정을 읽는다.
 * key='auth_config'인 행의 value(JSONB)에 저장.
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  const { data } = await supabaseAdmin
    .from('inf_settings')
    .select('value')
    .eq('key', AUTH_CONFIG_KEY)
    .single();

  if (!data?.value) return { ...DEFAULT_CONFIG };

  const v = data.value as Record<string, unknown>;
  return {
    password_hash: (v.password_hash as string) ?? null,
    admin_email: (v.admin_email as string) ?? null,
    session_version: (v.session_version as number) ?? 1,
    setup_completed: (v.setup_completed as boolean) ?? false,
  };
}

/**
 * 인증 설정을 업데이트한다. 기존 값에 병합(merge).
 */
export async function updateAuthConfig(updates: Partial<AuthConfig>): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('inf_settings')
    .select('id, value')
    .eq('key', AUTH_CONFIG_KEY)
    .single();

  if (existing) {
    const merged = { ...(existing.value as Record<string, unknown>), ...updates };
    await supabaseAdmin
      .from('inf_settings')
      .update({
        value: merged,
        updated_by: 'system',
        updated_at: new Date().toISOString(),
      })
      .eq('key', AUTH_CONFIG_KEY);
  } else {
    await supabaseAdmin.from('inf_settings').insert({
      key: AUTH_CONFIG_KEY,
      value: { ...DEFAULT_CONFIG, ...updates },
      updated_by: 'system',
    });
  }
}
