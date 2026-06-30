/**
 * Resend stub — used only at unit-test time. The real `@resend/node`
 * package is not installed; the email-service needs only a class with
 * `emails.send()` to typecheck and run.
 */
export interface SendEmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}
export interface SendEmailResult {
  data: { id: string } | null;
  error: { message: string } | null;
}
export class Resend {
  constructor(_apiKey?: string) {}
  emails = {
    send: async (_opts: SendEmailOptions): Promise<SendEmailResult> => ({
      data: { id: 'stub' },
      error: null,
    }),
  };
}
