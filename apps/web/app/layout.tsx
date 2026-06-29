import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pazzera — pay per listen, own your sound',
  description:
    'Decentralized pay-per-listen music streaming. Direct artist payouts, nano payments in USDC on Arc.',
  metadataBase: new URL(
    process.env.APP_BASE_URL ?? 'http://localhost:3000',
  ),
  openGraph: {
    title: 'Pazzera',
    description: 'Pay per listen, own your sound.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Pazzera' },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}