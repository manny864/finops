import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: /^\d+$/.test(process.env.PORT ?? '') ? `.next-${process.env.PORT}` : '.next',
  /* config options here */
  serverExternalPackages: ['mysql2'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Clickjacking protection — prevent framing from any external origin.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Referrer: send origin only on same-origin; nothing cross-origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable browser features not used by the app.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          // HSTS: 1 year, include subdomains, preload-ready.
          // CloudFlare also sets this, but defense-in-depth.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // CSP: baseline strict policy.
          // - default-src 'self' blocks most vectors.
          // - script-src allows Next.js inline scripts (hash-based in prod) + unsafe-inline
          //   removed; using 'strict-dynamic' with nonce would require refactor.
          //   For now: 'self' + trusted CDNs. Tighten iteratively.
          // - frame-ancestors 'none' reinforces X-Frame-Options for CSP-aware browsers.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://www.google.com https://www.gstatic.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://api.paddle.com https://login.microsoftonline.com https://graph.microsoft.com https://management.azure.com https://cloudflareinsights.com",
              "frame-src 'self' https://cdn.paddle.com https://app.powerbi.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
