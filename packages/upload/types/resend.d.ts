/**
 * Type stub for `resend` (email provider) so core/services/email-service
 * can be type-checked independently of the app. The real `@resend/node`
 * package provides the same interface — these stubs exist purely to make
 * cross-package tsc work without a circular dep on the Next app.
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
