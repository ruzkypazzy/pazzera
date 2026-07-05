import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Pazzera — pay once, every time you listen',
  description:
    'Decentralized pay-per-listen music streaming. Stream music. Pay artists instantly in USDC on Arc.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000',
  ),
  applicationName: 'Pazzera',
  openGraph: {
    title: 'Pazzera — pay once, every time you listen',
    description: 'Pay per listen, own your sound. Decentralized streaming on Arc with USDC nano-payments.',
    type: 'website',
    siteName: 'Pazzera',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pazzera — pay once, every time you listen',
    description: 'Pay per listen, own your sound.',
  },
  icons: {
    icon: [{ url: '/icon', type: 'image/png' }],
    apple: [{ url: '/icon', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#09090D',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="min-h-screen bg-[#09090D] text-white antialiased">{children}</body>
    </html>
  );
}