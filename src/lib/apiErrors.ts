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
    const detail = error instanceof Error ? error.message : String(error);

    console.error(`[api-error]${opts?.context ? ' ' + opts.context : ''}:`, error);

    const body: Record<string, unknown> = { error: message };
    if (process.env.NODE_ENV !== 'production') {
        body.details = detail;
    }
    return NextResponse.json(body, { status });
}
