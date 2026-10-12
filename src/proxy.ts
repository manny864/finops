import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';

const intlMiddleware = createMiddleware({
  locales: ['en', 'es', 'pt-BR'],
  defaultLocale: 'es'
});

/**
 * CSP con nonce + 'strict-dynamic' en modo REPORT-ONLY (A-3).
 *
 * La CSP *enforcing* sigue en next.config.ts (con 'unsafe-inline'). Esta
 * política Report-Only NO bloquea: el navegador solo reporta violaciones,
 * permitiendo validar en producción qué scripts inline quedarían fuera de una
 * CSP estricta (Paddle, reCAPTCHA, Cloudflare Insights) antes de promoverla a
 * enforcing y quitar 'unsafe-inline'. No puede romper checkout/login.
 */
function reportOnlyCsp(nonce: string): string {
  // Sandbox de Paddle en dev y en un build con token de cliente de sandbox (`test_`, staging) — en un build de
  // producción el token es live y los dominios sandbox no deben figurar como orígenes permitidos (least privilege).
  // Mismo criterio que next.config.ts; el acceso a NEXT_PUBLIC_* es literal para que Next lo inlinee al compilar.
  const isDev = process.env.NODE_ENV !== 'production';
  const usaPaddleSandbox = isDev || (process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? '').startsWith('test_');
  const sbCdn = usaPaddleSandbox ? ' https://sandbox-cdn.paddle.com' : '';
  const sbApi = usaPaddleSandbox ? ' https://sandbox-api.paddle.com https://checkout-service.sandbox.paddle.com' : '';
  const sbBuy = usaPaddleSandbox ? ' https://sandbox-buy.paddle.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.paddle.com${sbCdn}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://api.paddle.com https://cdn.paddle.com https://checkout-service.paddle.com${sbApi}${sbCdn} https://login.microsoftonline.com https://graph.microsoft.com https://management.azure.com https://cloudflareinsights.com`,
    `frame-src 'self' https://cdn.paddle.com https://buy.paddle.com${sbCdn}${sbBuy} https://app.powerbi.com https://www.google.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export default function proxy(request: NextRequest) {
  // Ejecuta el middleware de i18n (routing de locale) y le añade la cabecera
  // CSP Report-Only sobre el NextResponse que devuelve.
  const response = intlMiddleware(request);
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  response.headers.set('Content-Security-Policy-Report-Only', reportOnlyCsp(nonce));
  return response;
}

export const config = {
  // Skip all paths that should not be internationalized
  matcher: ['/((?!api|_next|.*\\..*).*)']
};
