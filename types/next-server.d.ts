/**
 * Global stub for `next/server` — provided as a root-level .d.ts so any
 * package that imports from `next/server` (without pulling in Next.js)
 * gets a valid type declaration.
 *
 * Lives at the workspace root and is picked up because TS auto-discovers
 * `.d.ts` files from the project + every `include`d folder, AND because
 * tsconfig.base.json's `exclude` only ignores `node_modules`/`dist`/.
 */
declare module 'next/server' {
  export interface NextRequest extends Request {
    cookies: { get(name: string): { value: string } | undefined };
    ip?: string;
    nextUrl: { pathname: string; searchParams: URLSearchParams; search: string };
  }
  export interface NextResponse extends Response {
    cookies: { set(opts: { name: string; value: string }): void };
    headers: Headers;
  }
  export const NextResponse: {
    json(body: unknown, init?: { status?: number; headers?: HeadersInit }): NextResponse;
    next(): NextResponse;
  };
}
