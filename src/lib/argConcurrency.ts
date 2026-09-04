/**
 * Limitador global de concurrencia y backoff adaptativo para Azure Resource Graph (ARG).
 *
 * Mecánica de ARG:
 *  - Límite de capacidad: 15 queries por ventana móvil de 5 segundos por Service Principal.
 *  - Encabezados de respuesta:
 *      x-ms-user-quota-remaining (tokens restantes)
 *      x-ms-user-quota-resets-after (formato "hh:mm:ss", tiempo para reponer cuota)
 *      retry-after (segundos)
 *  - Al recibir 429 / RateLimiting, pausamos la cola globalmente por el tiempo
 *    indicado (o mínimo 5.5s) y reintentamos automáticamente.
 */

import { crearLimitadorGlobal } from "./apiThrottle";

export function extractArgRetryAfterMs(err: any): number | null {
  const headers = err?.response?.headers || err?.headers || {};
  const getHeader = (name: string): string | undefined => {
    if (typeof headers.get === 'function') {
      return headers.get(name) || headers.get(name.toLowerCase());
    }
    if (typeof headers === 'object' && headers !== null) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name.toLowerCase()) {
          return String(headers[key]);
        }
      }
    }
    return undefined;
  };

  const retryAfter = getHeader('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  }

  const resetsAfter = getHeader('x-ms-user-quota-resets-after');
  if (resetsAfter) {
    const parts = String(resetsAfter).split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      const ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      if (ms > 0) return ms;
    }
  }

  return null;
}

export function isArg429(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  const code = err?.code ?? err?.error?.code;
  const msg = String(err?.message || err?.body?.error?.message || err?.body?.message || '');
  return status === 429
    || code === 'RateLimiting'
    || code === 'TooManyRequests'
    || /ratelimit|too many requests|throttl/i.test(msg);
}

/**
 * La mecanica --cola, pacing y pausa global-- vive en `apiThrottle`, porque Cost
 * Management necesitaba exactamente lo mismo y tenerlo dos veces garantizaba que
 * un arreglo entrara en una sola. Los numeros de aca son los de ARG y no
 * cambian: piso de 5.5s (la ventana movil es de 5s), techo de 45s.
 *
 * El estado es propio de esta instancia: un 429 de Cost Management no tiene por
 * que frenar las consultas a Resource Graph.
 */
const limitadorArg = crearLimitadorGlobal(
  {
    nombre: "ARG",
    maxConcurrent: Number(process.env.ARG_MAX_CONCURRENT || 2),
    pacingMs: 200,
    minBackoffMs: 5500,
    maxBackoffMs: 45000,
    factor: 2,
    jitterMs: 1000,
    minRetryAfterMs: 5500,
  },
  isArg429,
  extractArgRetryAfterMs,
);

/**
 * Ejecuta `fn` respetando el limite global de concurrencia y backoff hacia ARG.
 */
export function withArgLimit<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; label?: string; signal?: AbortSignal } = {}
): Promise<T> {
  return limitadorArg(fn, opts);
}
