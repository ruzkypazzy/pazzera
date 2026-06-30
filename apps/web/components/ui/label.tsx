'use client';
import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium text-fg-muted', className)} {...props} />
  ),
);
Label.displayName = 'Label';
