/**
 * Minimal stub for `next/server` used only at unit-test time.
 * Mirrors the shape declared in `@pazzera/core/types/next-server.d.ts`.
 */
export interface NextRequest extends Request {
  cookies: { get(name: string): { value: string } | undefined };
  ip?: string;
  nextUrl: { pathname: string; searchParams: URLSearchParams; search: string };
}
export interface NextResponse extends Response {
  cookies: { set(opts: { name: string; value: string }): void };
}
export const NextResponse = {
  json(body: unknown, init?: { status?: number; headers?: HeadersInit }): NextResponse {
    return new Response(JSON.stringify(body), init) as unknown as NextResponse;
  },
  next(): NextResponse {
    return new Response(null) as unknown as NextResponse;
  },
  redirect(url: URL | string, _init?: { status?: 301 | 302 | 303 | 307 | 308 }): NextResponse {
    return new Response(null, { status: 302, headers: { location: typeof url === 'string' ? url : url.href } }) as unknown as NextResponse;
  },
};
