export class NextResponse {
  status = 200;
  headers: { [k: string]: string } = {};
  constructor(public body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    if (init?.status) this.status = init.status;
    if (init?.headers) this.headers = init.headers;
  }
  static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    const r = new NextResponse(body, init);
    r.headers['content-type'] = init?.headers?.['content-type'] ?? 'application/json';
    return r;
  }
}
