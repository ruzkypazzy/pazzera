import { Suspense } from 'react';
import { VerifyOtpForm } from '@/components/auth/verify-otp-form';

export const metadata = { title: 'Verify — Pazzera' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const sp = await searchParams;
  const email = sp.email ?? '';
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Check your email</h1>
          <p className="mt-2 text-fg-muted text-sm">Enter the code we just sent you.</p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-elevated p-6 shadow-2xl">
          {email ? (
            <VerifyOtpForm email={email} />
          ) : (
            <div className="text-sm text-fg-muted">
              No email provided.{' '}
              <a href="/sign-in" className="text-accent hover:underline">
                Try again
              </a>
              .
            </div>
          )}
        </div>
      </div>
    </main>
  );
}