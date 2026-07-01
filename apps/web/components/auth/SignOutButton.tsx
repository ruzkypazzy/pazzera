'use client';

import { useState } from 'react';

/**
 * Sign-out button — submits a POST to /api/auth/logout and redirects home.
 * Lives in a dedicated client component because <form onSubmit> cannot
 * appear in a server component (Next.js + React Server Components).
 */
export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="pt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {
          // ignore network failure — still redirect
        }
        window.location.href = '/';
      }}
    >
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full border border-[#282828] bg-transparent px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06] disabled:opacity-50"
      >
        {loading ? 'Signing out…' : 'Sign out'}
      </button>
    </form>
  );
}