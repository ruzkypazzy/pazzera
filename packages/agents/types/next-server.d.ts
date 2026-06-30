/**
 * Type stub for `next/server` so the package's middleware layer can
 * be type-checked independently of the Next.js app runtime.
 */
declare module 'next/server' {
  export interface NextRequest extends Request {
    cookies: { get(name: string): { value: string } | undefined };
    ip?: string;
    nextUrl: { pathname: string; searchParams: URLSearchParams; search: string; clone(): { pathname: string; searchParams: URLSearchParams; search: string; }; };
  }
  export interface NextResponse extends Response {
    cookies: { set(opts: { name: string; value: string }): void };
    headers: Headers;
  }
  export const NextResponse: {
    json(body: unknown, init?: { status?: number; headers?: HeadersInit }): NextResponse;
    next(): NextResponse;
    redirect(url: URL | string, init?: { status?: 301 | 302 | 303 | 307 | 308 }): NextResponse;
  };
}
