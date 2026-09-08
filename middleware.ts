import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'heeda_session';

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return new TextEncoder().encode(secret);
}

function isPublicPath(pathname: string): boolean {
  // Standalone pages
  if (pathname === '/login' || pathname === '/setup' || pathname === '/') return true;

  // Auth + admin API
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/admin/')) return true;

  // Public API (consent/settlement forms)
  if (pathname.startsWith('/api/public/')) return true;

  // Cron (uses its own CRON_SECRET bearer token)
  if (pathname.startsWith('/api/cron/')) return true;

  // Public influencer form pages
  if (/^\/influencer\/consent\/[^/]+/.test(pathname)) return true;
  if (/^\/influencer\/settlement\/[^/]+/.test(pathname)) return true;

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return handleUnauthorized(request, pathname);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sv || payload.role !== 'admin') {
      return handleUnauthorized(request, pathname);
    }
    return NextResponse.next();
  } catch {
    return handleUnauthorized(request, pathname);
  }
}

function handleUnauthorized(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|heeda-logo\\.png).*)'],
};
