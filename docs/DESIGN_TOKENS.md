# Pazzera Design Tokens

> Visual identity: **black / near-black surfaces · green payment accent · glassmorphism · neon pulse animations**

All tokens are CSS custom properties on `:root` in `apps/web/app/globals.css`. Tailwind reads them via `hsl(var(--…))` so the palette can be re-themed without touching component code.

## 1. Color

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `0 0% 4%` | App background (near-black) |
| `--bg-elevated` | `0 0% 7%` | Cards, list rows |
| `--bg-muted` | `0 0% 10%` | Skeletons, dividers, hover surfaces |
| `--fg` | `0 0% 98%` | Primary text |
| `--fg-muted` | `0 0% 65%` | Secondary text |
| `--fg-subtle` | `0 0% 45%` | Disabled, hints |
| `--accent` | `142 76% 45%` | Brand green (payments, primary actions) |
| `--accent-soft` | `142 76% 55%` | Hover/active accent |
| `--neon` | `142 100% 60%` | Neon pulse animation color |
| `--danger` | `0 84% 60%` | Errors, destructive |
| `--success` | `142 76% 45%` | Confirmed, alive |
| `--warning` | `38 92% 50%` | Risk, pending |
| `--border` | `0 0% 14%` | Default border |
| `--border-soft` | `0 0% 9%` | Subtle dividers |
| `--ring` | `142 76% 45%` | Focus rings (matches accent) |

## 2. Glassmorphism

Three reusable utility classes built on the same color family:

| Class | Use |
|---|---|
| `.glass` | Soft overlay (sidebar bottom panels, demo-mode cards) |
| `.glass-strong` | Modal sheets, top bar, sticky player — needs more contrast |
| (no class) | Use `border border-border bg-bg-elevated` for opaque cards |

Both glass classes use the same alpha channel — they look right on top of any of our surfaces.

## 3. Payment animations

Two effects reserved for payment activity:

| Class | Effect | Where |
|---|---|---|
| `.neon-pulse` | Animated 20px+40px green outer glow, 1.6s loop | Payment-toast, manual-review banners |
| `.neon-ring` | Static 1px neon ring + glow | Player cover art during a payment, KPI cards that represent money |

Plus a `motion` (Framer Motion) `boxShadow` animation in the sticky player that fires for 2s when the Fan Agent triggers (see `components/player/sticky-player.tsx`).

## 4. Typography

- **Sans**: `var(--font-sans)` → system stack by default. To swap in Inter or Geist, add a `next/font` import in `app/layout.tsx`.
- **Mono**: SF Mono / Menlo / Consolas (used inline for addresses and OTP codes)
- **Headings**: `font-bold tracking-tight` (1.5px negative tracking)
- **Tabular numerics**: `tabular-nums` for all money/duration/count displays

## 5. Motion

- **Framer Motion** for orchestrated entrances (`<motion.div initial=… animate=…>`)
- **CSS keyframes** for repeating effects: `neon-pulse` (1.6s), `aurora-drift` (18s), `shimmer` (skeleton)
- All entrance animations use `duration: 0.3–0.4` + spring `{ stiffness: 280, damping: 26 }`

## 6. Spacing & radii

- **Cards**: `rounded-2xl` (16px) or `rounded-3xl` (24px) for hero panels
- **Buttons**: `rounded-full` (pills) — premium feel
- **Inputs**: `rounded-xl` (12px) with `h-11` (44px) for comfortable touch
- **Inner padding**: `p-5` (20px) on cards, `p-6` (24px) on modal sheets, `p-8` on hero sections

## 7. Shadows

Three shadow tiers, all in the `shadow-` family (Tailwind config + custom):

- `shadow` (default) — barely there
- `shadow-lg` — for lifted chips
- `shadow-2xl` — for hero cards + modals + cover art
- `shadow-[0_8px_32px_rgba(0,0,0,0.35)]` — custom for elevated cards

## 8. Layout primitives

| Pattern | Where |
|---|---|
| `mx-auto max-w-7xl px-4 md:px-8 py-6` | Standard page container |
| `mx-auto max-w-5xl …` | Detail pages (song, profile) |
| `mx-auto max-w-3xl …` | Forms (artist onboarding) |
| `grid grid-cols-{n} gap-{n}` | Card grids; use `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4` for responsive |
| `flex gap-3 overflow-x-auto no-scrollbar` | Carousels (trending, recently played) |

## 9. Demo mode toggle

`apps/web/lib/demo-mode.ts` reads a `DEMO_MODE` env var. When on:

- `useDemoPaymentSimulation` fires a synthetic `stream:payment_settled` + `stream:payout_done` pair every 12s
- The live payment toast host picks them up and renders the floating notifications
- No real on-chain activity happens

Set `DEMO_MODE=true` in `.env` for hackathon demos. Set `false` (or omit) for production.

## 10. Reusable component index

`apps/web/components/ui/*` — primitives
- `Button` (primary / secondary / ghost / danger)
- `Input`, `Label`, `Textarea` (use `cn()` to merge)
- `Avatar`, `AvatarImage`, `AvatarFallback`
- `Badge` (default / accent / danger / warning / success / outline / glass)
- `Dialog` (Radix) — used by upload modal
- `Progress` — used in onboarding, splits
- `Separator` — section dividers
- `Skeleton` — shimmer loading state
- `Switch` — preferences toggles
- `Tabs` (Radix) — used in library page

`apps/web/components/shell/*` — app shell
- `Sidebar` — fixed left nav
- `TopBar` — search, wallet pill, notifications, user menu

`apps/web/components/player/*`
- `StickyPlayer` — bottom playback footer

`apps/web/components/realtime/*`
- `PaymentToastHost` — floating live-payment toasts (the strategic recommendation)

`apps/web/components/{auth,wallet,artist,library,search,song,profile,admin,dashboard,player}/*` — page-specific client components.