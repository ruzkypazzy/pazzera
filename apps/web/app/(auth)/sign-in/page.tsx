import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/sign-in-form';
import { PazzeraLogo } from '@/components/logo';
import Link from 'next/link';

export const metadata = { title: 'Sign in — Pazzera' };

export default function SignInPage() {
  return (
    <main className="min-h-screen px-6 py-12" style={{ background: '#0A0A0A' }}>
      <div className="mx-auto max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="mb-6 inline-block">
            <PazzeraLogo size={64} />
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Welcome back</h1>
          <p className="mt-2 text-sm text-[#B3B3B3]">
            Sign in to Pazzera with your email — no password required.
          </p>
        </div>
        <div className="rounded-2xl border border-[#282828] bg-[#0F0F18] p-6 shadow-2xl">
          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>
        </div>
        <div className="mt-6 text-center text-xs text-[#B3B3B3]">
          New to Pazzera?{' '}
          <Link href="/sign-up" className="font-bold text-[#00D4AA] hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </main>
  );
}