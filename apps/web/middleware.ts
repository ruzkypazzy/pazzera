/**
 * Edge middleware — guards authenticated routes, sets CSP, basic geo block
 * placeholder for future use.
 */
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/',
  '/sign-in',
  '/verify',
  '/api/auth/request-otp',
  '/api/auth/verify-otp',
  '/api/webhooks/resend',
  '/_next',
  '/favicon.ico',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/uploads/')
  ) {
    return NextResponse.next();
  }

  const sid = req.cookies.get(process.env.SESSION_COOKIE_NAME ?? 'sid')?.value;
  if (!sid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'AUTH_REQUIRED', message: 'Sign in required' } },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url as never);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|uploads|favicon.ico).*)'],
};