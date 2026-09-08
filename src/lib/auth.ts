import { getSessionFromCookies } from './session';
import { getAuthConfig } from './auth-store';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
}

/**
 * 세션 쿠키를 검증하고 DB의 session_version과 대조한다.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getSessionFromCookies();
  if (!session) return null;

  const config = await getAuthConfig();

  if (session.sv !== config.session_version) {
    return null; // session invalidated
  }

  return {
    id: 'admin',
    email: config.admin_email ?? 'admin@heeda.kr',
    role: 'admin',
  };
}

/**
 * 관리자 권한인지 확인한다. 미인증 시 Error throw.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * 요청에서 클라이언트 IP를 추출한다.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '0.0.0.0';
}
