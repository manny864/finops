import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: /^\d+$/.test(process.env.PORT ?? '') ? `.next-${process.env.PORT}` : '.next',
  /* config options here */
  serverExternalPackages: ['mysql2'],

  async headers() {
    // En desarrollo, Next.js/Turbopack y React (modo dev) requieren eval() para HMR,
    // sourcemaps y reconstrucción de callstacks. Se habilita 'unsafe-eval' SOLO en dev;
    // en producción la CSP permanece estricta (sin eval).
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = [
      "script-src 'self' 'unsafe-inline'",
      isDev ? "'unsafe-eval'" : '',
      "https://cdn.paddle.com https://sandbox-cdn.paddle.com https://www.google.com https://www.gstatic.com https://static.cloudflareinsights.com",
    ].filter(Boolean).join(' ');

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
              scriptSrc,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.paddle.com https://sandbox-cdn.paddle.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://api.paddle.com https://sandbox-api.paddle.com https://cdn.paddle.com https://sandbox-cdn.paddle.com https://checkout-service.paddle.com https://checkout-service.sandbox.paddle.com https://login.microsoftonline.com https://graph.microsoft.com https://management.azure.com https://cloudflareinsights.com",
              "frame-src 'self' https://cdn.paddle.com https://sandbox-cdn.paddle.com https://buy.paddle.com https://sandbox-buy.paddle.com https://app.powerbi.com",
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
