import { NextResponse } from 'next/server';

/**
 * Respuesta de error 500 estandarizada que NO filtra internals al cliente
 * (A-6 / L-02 del assessment 2026-07-05).
 *
 * - Loguea el error completo server-side (con contexto opcional) para
 *   diagnóstico.
 * - Al cliente devuelve solo un mensaje genérico. En desarrollo (NODE_ENV !==
 *   'production') incluye `details` para facilitar el debugging local; en
 *   producción se omite, evitando exponer mensajes de driver SQL, stack o
 *   detalles del proveedor de IA.
 *
 * Uso:
 *   } catch (error) {
 *     if (error instanceof AuthError) return NextResponse.json(...);
 *     return serverError(error, { context: 'POST /api/intelligence/upload' });
 *   }
 */
export function serverError(
    error: unknown,
    opts?: { context?: string; message?: string; status?: number }
): NextResponse {
    const message = opts?.message ?? 'Internal server error';
    const status = opts?.status ?? 500;
    const detail = errorMessage(error, String(error));

    console.error(`[api-error]${opts?.context ? ' ' + opts.context : ''}:`, error);

    const body: Record<string, unknown> = { error: message };
    if (process.env.NODE_ENV !== 'production') {
        body.details = detail;
    }
    return NextResponse.json(body, { status });
}

/**
 * Extrae el mensaje de un valor capturado en un `catch`. Con `strict: true`
 * TypeScript tipa la variable de catch como `unknown`, asi que hay que
 * estrechar antes de leer `.message`; este helper centraliza ese narrowing y
 * evita las 500+ anotaciones `catch (e: any)` que lo salteaban.
 */
export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        const m = (error as { message?: unknown }).message;
        if (typeof m === 'string') return m;
    }
    return fallback;
}

/**
 * Extrae el codigo de estado HTTP de un error de SDK o de `fetch`. Cubre las
 * tres formas que usan los SDKs de Azure y los errores propios del repo:
 * `status`, `statusCode` y `code` numerico.
 */
export function errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const e = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    for (const v of [e.status, e.statusCode, e.code]) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
        // Acotado al rango HTTP valido: `code` tambien lleva errnos de driver
        // (p. ej. 1045 de MySQL) y devolverlos haria que NextResponse lance
        // RangeError al construir la respuesta.
        if (n >= 100 && n <= 599) return n;
    }
    return undefined;
}

/** Codigo de error no numerico de un SDK (p. ej. 'ETIMEDOUT', 'AuthorizationFailed'). */
export function errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const c = (error as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
}
