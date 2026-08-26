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

const MAX_CONCURRENT = Number(process.env.ARG_MAX_CONCURRENT || 2);
const PACING_DELAY_MS = 200;

let active = 0;
let pausedUntil = 0;
let lastExecutionTime = 0;
const queue: Array<() => void> = [];

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

function scheduleNext() {
  if (active >= MAX_CONCURRENT) return;
  const now = Date.now();
  if (now < pausedUntil) {
    setTimeout(scheduleNext, Math.max(50, pausedUntil - now));
    return;
  }
  const timeSinceLast = now - lastExecutionTime;
  if (timeSinceLast < PACING_DELAY_MS) {
    setTimeout(scheduleNext, PACING_DELAY_MS - timeSinceLast);
    return;
  }
  const run = queue.shift();
  if (!run) return;
  active++;
  lastExecutionTime = Date.now();
  run();
}

/**
 * Ejecuta `fn` respetando el límite global de concurrencia y backoff hacia ARG.
 */
export async function withArgLimit<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  let attempt = 0;

  while (true) {
    try {
      return await new Promise<T>((resolve, reject) => {
        const run = () => {
          fn().then(
            (value) => {
              active--;
              scheduleNext();
              resolve(value);
            },
            (error) => {
              active--;
              scheduleNext();
              reject(error);
            }
          );
        };
        queue.push(run);
        scheduleNext();
      });
    } catch (err: any) {
      if (!isArg429(err) || attempt >= maxRetries) {
        throw err;
      }
      const rawRetryAfter = extractArgRetryAfterMs(err);
      const jitter = Math.floor(Math.random() * 1000);
      const backoff = rawRetryAfter
        ? Math.max(rawRetryAfter, 5500) + jitter
        : Math.min(45000, 5500 * Math.pow(2, attempt) + jitter);

      pausedUntil = Math.max(pausedUntil, Date.now() + backoff);
      console.warn(`[ARG] 429 Throttled on ${opts.label || 'ARG query'}. Pausing global ARG queue & retrying ${attempt + 1}/${maxRetries} in ${backoff}ms...`);
      await new Promise((r) => setTimeout(r, backoff));
      attempt++;
    }
  }
}
