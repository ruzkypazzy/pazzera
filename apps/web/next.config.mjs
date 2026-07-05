/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  eslint: {
    // Don't run ESLint as part of `next build` — it runs in the docker
    // builder with a stripped config and emits false positives on
    // path-alias resolution. We still run `pnpm typecheck` in CI.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: '50mb' },
    serverComponentsExternalPackages: [
      'bullmq',
      'ioredis',
      '@pazzera/queue',
      '@pazzera/blockchain',
      '@pazzera/storage',
      '@pazzera/agents',
      '@pazzera/realtime',
      '@pazzera/db',
      '@pazzera/core',
      'viem',
      'ethers',
    ],
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        dns: false,
        fs: false,
        child_process: false,
        worker_threads: false,
        os: false,
        path: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        url: false,
        zlib: false,
        buffer: false,
        util: false,
      };
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'node:crypto': 'crypto',
        'node:fs': 'fs',
        'node:path': 'path',
        'node:os': 'os',
        'node:stream': 'stream',
        'node:net': 'net',
        'node:tls': 'tls',
        'node:dns': 'dns',
        'node:child_process': 'child_process',
        'node:worker_threads': 'worker_threads',
        'node:fs/promises': 'fs/promises',
        'node:diagnostics_channel': 'diagnostics_channel',
        'node:http': 'http',
        'node:https': 'https',
        'node:url': 'url',
        'node:zlib': 'zlib',
        'node:buffer': 'buffer',
        'node:util': 'util',
      };
    }
    return config;
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://media.pazzera.com https://*.r2.cloudflarestorage.com",
      "media-src 'self' https://media.pazzera.com https://*.r2.cloudflarestorage.com blob:",
      "connect-src 'self' https://api.pazzera.com wss://pazzera.com https://*.r2.cloudflarestorage.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'media.pazzera.com' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
};
export default nextConfig;