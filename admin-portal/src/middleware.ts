import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-auth-constants';

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/ref' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/dashboard-stats'
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const hasSessionCookie = Boolean(sessionCookie);

  if (pathname === '/api/dashboard-stats' || pathname === '/api/auth/me') {
    console.log('[admin-portal middleware]', {
      pathname,
      hasSessionCookie,
      cookieLength: sessionCookie?.length || 0,
    });
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  const nextPath = `${pathname}${search || ''}`;
  if (nextPath && nextPath !== '/') {
    loginUrl.searchParams.set('next', nextPath);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
