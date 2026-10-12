import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: /^\d+$/.test(process.env.PORT ?? '') ? `.next-${process.env.PORT}` : '.next',
  /* config options here */
  serverExternalPackages: ['mysql2'],

  // Optimización de consumo de memoria RAM para compilación y HMR
  experimental: {
    optimizePackageImports: [
      '@tabler/icons-react',
      'lucide-react',
      'recharts',
      '@azure/arm-compute',
      '@azure/arm-costmanagement',
      '@azure/arm-network',
      '@azure/arm-resources',
      '@azure/arm-subscriptions',
      '@azure/arm-advisor',
      '@azure/arm-monitor',
      '@azure/arm-consumption',
      '@azure/arm-appservice',
      '@azure/identity',
    ],
  },

  // Liberar páginas inactivas de la memoria en modo desarrollo
  onDemandEntries: {
    maxInactiveAge: 60 * 1000, // 60 segundos
    pagesBufferLength: 5,      // Mantener máx 5 páginas en buffer
  },

  // Redirect legacy network slugs to canonical Spanish routes
  async redirects() {
    return [
      // `/intelligence/commitments` servía el mismo <Commitments /> que la
      // pestaña del hub, pero nunca estuvo en el sidebar: se llegaba sólo por
      // marcador o por un pin viejo del dashboard. Se borró la página y queda
      // el redirect para no romper ni una cosa ni la otra.
      { source: '/:locale/intelligence/commitments', destination: '/:locale/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris', permanent: true },
      { source: '/:locale/intelligence/redes/network', destination: '/:locale/intelligence/redes/analisis-de-red', permanent: true },
      { source: '/:locale/intelligence/redes/netwokbasic', destination: '/:locale/intelligence/redes/redes-basicas', permanent: true },
      { source: '/:locale/intelligence/redes/hibridcon', destination: '/:locale/intelligence/redes/conectividad-hibrida', permanent: true },
      { source: '/:locale/intelligence/redes/loadbalancer', destination: '/:locale/intelligence/redes/balanceo-y-publicacion', permanent: true },
      { source: '/:locale/intelligence/redes/internet', destination: '/:locale/intelligence/redes/acceso-a-internet', permanent: true },
    ];
  },

  async headers() {
    // En desarrollo, Next.js/Turbopack y React (modo dev) requieren eval() para HMR,
    // sourcemaps y reconstrucción de callstacks. Se habilita 'unsafe-eval' SOLO en dev;
    // en producción la CSP permanece estricta (sin eval).
    const isDev = process.env.NODE_ENV !== 'production';
    // Dominios sandbox de Paddle: en dev y en un build cuyo token de cliente es de sandbox (`test_`, el de
    // staging; es el mismo criterio con el que el navegador elige el entorno de Paddle.js). Un build de prod
    // lleva un token `live_` y NO los permite: en producción los tokens/price IDs son live y permitir sandbox
    // en el CSP viola least-privilege (además de generar confusión al leer la política — "¿por qué aparece
    // sandbox en prod?"). Sin esto el checkout sandbox de staging, que corre un build de producción, queda bloqueado.
    const usaPaddleSandbox = isDev || (process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? '').startsWith('test_');
    const paddleSandbox = {
      cdn: usaPaddleSandbox ? ' https://sandbox-cdn.paddle.com' : '',
      api: usaPaddleSandbox ? ' https://sandbox-api.paddle.com https://checkout-service.sandbox.paddle.com' : '',
      buy: usaPaddleSandbox ? ' https://sandbox-buy.paddle.com' : '',
    };
    const scriptSrc = [
      "script-src 'self' 'unsafe-inline'",
      isDev ? "'unsafe-eval'" : '',
      `https://cdn.paddle.com${paddleSandbox.cdn} https://www.google.com https://www.gstatic.com https://static.cloudflareinsights.com`,
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
          // HSTS: 1 year, include subdomains, preload-ready. SOLO en producción:
          // en dev el server sirve HTTP plano (sin TLS), y este header le dice al
          // navegador "recordá por 1 año que este origin es HTTPS-only". Safari
          // (a diferencia de Chrome, que exceptúa "localhost") cachea igual esa
          // política para localhost, y termina forzando https://localhost:3000
          // en cada visita — que falla con error de TLS porque ahí no hay
          // certificado. CloudFlare también setea este header en prod, esto es
          // defensa en profundidad solo quería aplicar quando corresponde.
          ...(isDev ? [] : [{
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          }]),
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
              `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.paddle.com${paddleSandbox.cdn}`,
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              `connect-src 'self' https://api.paddle.com https://cdn.paddle.com https://checkout-service.paddle.com${paddleSandbox.api}${paddleSandbox.cdn} https://login.microsoftonline.com https://graph.microsoft.com https://management.azure.com https://cloudflareinsights.com`,
              `frame-src 'self' https://cdn.paddle.com https://buy.paddle.com${paddleSandbox.cdn}${paddleSandbox.buy} https://app.powerbi.com https://www.google.com`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              // Solo en prod: en dev forzaría subrecursos http://localhost a
              // https, que no existe acá (mismo motivo que el HSTS de arriba).
              isDev ? '' : "upgrade-insecure-requests",
            ].filter(Boolean).join('; '),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
