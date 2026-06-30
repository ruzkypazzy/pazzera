'use client';
import { useEffect, useState } from 'react';

/**
 * Demo mode hook — reads a flag set by the server-rendered layout so
 * client components can opt into demo behavior (simulated live payments,
 * preloaded data, etc.) without a separate API call.
 */
export function useDemoMode(): { enabled: boolean } {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const flag = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('pazzera-demo='));
    if (flag?.includes('1')) setEnabled(true);
    setEnabled(true); // demo mode always on for Phase 5 previews
  }, []);
  return { enabled };
}