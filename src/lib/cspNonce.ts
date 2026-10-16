/**
 * PERIM-01: CSP con nonce por documento para las páginas (src/proxy.ts).
 *
 * - El nonce viaja a Next.js en la cabecera de PETICIÓN `Content-Security-Policy`
 *   (app-render la lee y marca sus scripts, los de next/script y los inline del
 *   framework) y como `x-nonce` para los componentes propios (next-themes).
 * - 'strict-dynamic': lo que cargue un script con nonce (Paddle.js, reCAPTCHA vía
 *   next/script) hereda la confianza; las listas de hosts se ignoran en navegadores
 *   CSP3 y quedan como fallback en los viejos.
 * - Report-Only por defecto. `CSP_ENFORCE=true` la promueve a enforcing y, como el
 *   proxy corre después de los headers de next.config.ts, la cabecera del proxy
 *   reemplaza a la baseline de runtime (con 'unsafe-inline') en las páginas: no quedan dos
 *   políticas enforcing. API y estáticos (fuera del matcher) conservan la baseline.
 */
export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp";
import { getPublicRuntimeConfig } from "./publicRuntimeConfig";

export function baselineCsp(): string {
    return nonceCsp("baseline")
        .replace(/script-src [^;]+/, [
            "script-src 'self' 'unsafe-inline'",
            process.env.NODE_ENV !== "production" ? "'unsafe-eval'" : "",
            "https://cdn.paddle.com https://www.google.com https://www.gstatic.com https://static.cloudflareinsights.com",
            process.env.NODE_ENV !== "production" || getPublicRuntimeConfig().paddleClientToken.startsWith("test_")
                ? "https://sandbox-cdn.paddle.com" : "",
        ].filter(Boolean).join(" "));
}

export function generateNonce(): string {
    return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function cspEnforced(): boolean {
    return process.env.CSP_ENFORCE === "true";
}

export function nonceCsp(nonce: string): string {
    // Read at request time: staging/prod use the same image but different Paddle environments.
    const isDev = process.env.NODE_ENV !== 'production';
    const usaPaddleSandbox = isDev || getPublicRuntimeConfig().paddleClientToken.startsWith('test_');
    const sbCdn = usaPaddleSandbox ? ' https://sandbox-cdn.paddle.com' : '';
    const sbApi = usaPaddleSandbox ? ' https://sandbox-api.paddle.com https://checkout-service.sandbox.paddle.com' : '';
    const sbBuy = usaPaddleSandbox ? ' https://sandbox-buy.paddle.com' : '';
    return [
        "default-src 'self'",
        // Sin 'unsafe-inline': un <script> inyectado sin nonce no corre. 'unsafe-eval' sólo en dev (HMR).
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:${isDev ? " 'unsafe-eval'" : ""}`,
        "script-src-attr 'none'",
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.paddle.com${sbCdn}`,
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        `connect-src 'self' https://api.paddle.com https://cdn.paddle.com https://checkout-service.paddle.com${sbApi}${sbCdn} https://login.microsoftonline.com https://graph.microsoft.com https://management.azure.com https://cloudflareinsights.com`,
        `frame-src 'self' https://cdn.paddle.com https://buy.paddle.com${sbCdn}${sbBuy} https://app.powerbi.com https://www.google.com`,
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        isDev ? "" : "upgrade-insecure-requests",
        `report-uri ${CSP_REPORT_PATH}`,
        `report-to ${CSP_REPORT_GROUP}`,
    ].filter(Boolean).join("; ");
}

const OVERRIDE = "x-middleware-override-headers";
const REQUEST_PREFIX = "x-middleware-request-";

/**
 * Garantiza que el render reciba `x-nonce` y `content-security-policy` como
 * cabeceras de petición. next-intl ya las copia (arma `new Headers(request.headers)`
 * con el request que le pasamos), pero si devolviera un `next()`/`rewrite()` sin
 * override, se agregan acá. Ojo con la API interna de Next 16: toda cabecera de
 * petición que NO figure en `x-middleware-override-headers` se BORRA, así que si no
 * había lista se declara la petición completa (si no, se perderían las cookies).
 * Las redirecciones no renderizan: no se tocan.
 */
export function forwardRequestHeaders(response: Response, requestHeaders: Headers, names: string[]): void {
    const h = response.headers;
    if (!h.has("x-middleware-next") && !h.has("x-middleware-rewrite")) return;
    const existing = (h.get(OVERRIDE) ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
    const overrides = new Set(existing);
    if (overrides.size === 0) {
        for (const [key, value] of requestHeaders) {
            overrides.add(key);
            h.set(REQUEST_PREFIX + key, value);
        }
    }
    for (const name of names) {
        const value = requestHeaders.get(name);
        if (value === null) continue;
        overrides.add(name);
        h.set(REQUEST_PREFIX + name, value);
    }
    h.set(OVERRIDE, [...overrides].join(","));
}
