'use client';
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

/**
 * Pazzera Switch — clearly distinguishable ON / OFF states.
 * - ON:  teal #00D4AA background, white thumb
 * - OFF: dark gray #3A3A3A background, muted thumb
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none transition-colors duration-200',
      'focus-visible:ring-2 focus-visible:ring-[#00D4AA]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0F18]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      // ON state — vibrant teal
      'data-[state=checked]:bg-[#00D4AA]',
      // OFF state — clearly visible dark gray
      'data-[state=unchecked]:bg-[#3A3A3A]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] ring-0 transition-transform duration-200',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;