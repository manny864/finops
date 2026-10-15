import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { CSP_REPORT_GROUP, CSP_REPORT_PATH, cspEnforced, forwardRequestHeaders, generateNonce, nonceCsp } from '@/lib/cspNonce';

const intlMiddleware = createMiddleware({
  locales: ['en', 'es', 'pt-BR'],
  defaultLocale: 'es'
});

/**
 * CSP con nonce + 'strict-dynamic' (PERIM-01, ver src/lib/cspNonce.ts).
 *
 * Report-Only por defecto: la CSP enforcing de las páginas sigue siendo la baseline de
 * next.config.ts (con 'unsafe-inline') hasta que CSP_ENFORCE=true, que pone esta política
 * como Content-Security-Policy y reemplaza a la baseline en las rutas del matcher.
 */
export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const policy = nonceCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js extrae el nonce de esta cabecera de PETICIÓN para marcar sus scripts.
  requestHeaders.set('content-security-policy', policy);

  const response = intlMiddleware(new NextRequest(request, { headers: requestHeaders }));
  forwardRequestHeaders(response, requestHeaders, ['x-nonce', 'content-security-policy']);

  response.headers.set(cspEnforced() ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', policy);
  response.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  // HTML con nonce: nunca compartido por la CDN ni reutilizado entre requests.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  // Skip all paths that should not be internationalized
  matcher: ['/((?!api|_next|.*\\..*).*)']
};
