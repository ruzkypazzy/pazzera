/**
 * Global stub for `resend` so packages that wrap it (e.g. email-service)
 * can compile without depending on the real `@resend/node` package.
 */
declare module 'resend' {
  export interface SendEmailOptions {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
  }
  export interface SendEmailResult {
    data: { id: string } | null;
    error: { message: string } | null;
  }
  export class Resend {
    constructor(apiKey?: string);
    emails: {
      send(opts: SendEmailOptions): Promise<SendEmailResult>;
    };
  }
}
