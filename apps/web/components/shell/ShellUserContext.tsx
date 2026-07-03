'use client';

import { createContext, useContext } from 'react';

export type ShellUser = {
  isArtist: boolean;
  isAdmin: boolean;
  walletBalance: string;
  displayName?: string;
  username?: string;
};

export const ShellUserContext = createContext<ShellUser | null>(null);

export function useShellUser(): ShellUser {
  const ctx = useContext(ShellUserContext);
  // Fallback so AppShell still renders correctly when used outside
  // the (app) layout (e.g. tests, marketing pages).
  return (
    ctx ?? { isArtist: false, isAdmin: false, walletBalance: '0.00' }
  );
}