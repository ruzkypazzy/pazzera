import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata = { title: 'Sign in — Pazzera' };

export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-fg-muted text-sm">
            Sign in to Pazzera with your email — no password required.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-elevated p-6 shadow-2xl">
          <SignInForm />
        </div>
      </div>
    </main>
  );
}