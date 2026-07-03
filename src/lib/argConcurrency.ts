/**
 * Limitador global de concurrencia para llamadas a Azure Resource Graph (ARG).
 *
 * Problema que resuelve: cada servicio (auditService, ttlService, haService,
 * rightsizing, aks-chargeback, power) maneja su propia concurrencia interna
 * (batches de N), pero todos se disparan EN PARALELO cuando el dashboard
 * carga. La suma de "N concurrentes por servicio" termina siendo mucho mayor
 * que el límite real de throttling de ARG, generando una tormenta de 429 que
 * vacía categorías completas de recursos (zombies, HA, rightsizing, etc.).
 *
 * Este módulo expone una cola compartida a nivel de proceso: sin importar
 * cuántos servicios llamen a la vez, solo `ARG_MAX_CONCURRENT` requests a ARG
 * están en vuelo simultáneamente en todo el servidor.
 *
 * Nota: el límite es por-proceso (no distribuido). Suficiente para el
 * despliegue actual (single instance vía docker-compose); si se escala
 * horizontalmente habría que mover esto a un limitador distribuido (Redis).
 */

const MAX_CONCURRENT = Number(process.env.ARG_MAX_CONCURRENT || 4);

let active = 0;
const queue: Array<() => void> = [];

function scheduleNext() {
  if (active >= MAX_CONCURRENT) return;
  const run = queue.shift();
  if (!run) return;
  active++;
  run();
}

/**
 * Ejecuta `fn` respetando el límite global de concurrencia hacia ARG.
 * Uso: `await withArgLimit(() => client.resources({ query, subscriptions }))`
 */
export function withArgLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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
}
