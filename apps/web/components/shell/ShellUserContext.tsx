'use client';

import { createContext, useContext } from 'react';

export type ShellUser = {
  isArtist: boolean;
  isAdmin: boolean;
  walletBalance: string;
  displayName?: string;
  username?: string;
};

// Export the Provider separately so server components (which can't
// call `useContext`) can still wrap children in the provider without
// having to access `.Provider` on the default-exported context object.
export const ShellUserProvider = createContext<ShellUser | null>(null).Provider;

const ShellUserContext = createContext<ShellUser | null>(null);

export function useShellUser(): ShellUser {
  const ctx = useContext(ShellUserContext);
  // Fallback so AppShell still renders correctly when used outside
  // the (app) layout (e.g. tests, marketing pages).
  return (
    ctx ?? { isArtist: false, isAdmin: false, walletBalance: '0.00' }
  );
}