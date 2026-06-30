import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-bg-muted text-fg',
        accent: 'bg-accent/10 text-accent border border-accent/20',
        danger: 'bg-danger/10 text-danger border border-danger/20',
        warning: 'bg-warning/10 text-warning border border-warning/20',
        success: 'bg-success/10 text-success border border-success/20',
        outline: 'border border-border text-fg-muted',
        glass: 'glass text-fg-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}