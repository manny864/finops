import { redis } from './redis';
import { errorMessage } from '@/lib/apiErrors';

/**
 * Envelope que envuelve cada entrada del cache con su timestamp para poder
 * implementar SWR con soft/hard TTL sin pegarle al backend en cada hit.
 */
type Envelope<T> = { __sw: true; t: number; data: T };

function isEnvelope<T>(x: any): x is Envelope<T> {
  return x !== null && typeof x === 'object' && x.__sw === true && typeof x.t === 'number';
}

function isRedisReady(): boolean {
  return redis?.status === 'ready' || redis?.status === 'connect';
}

/**
 * Obtiene datos del caché o ejecuta una función para traerlos y guardarlos si no existen.
 * @param key Clave única para el caché
 * @param fetcher Función que obtiene los datos si no están en caché
 * @param ttl Tiempo de vida del caché en segundos (por defecto 1 hora)
 */
export async function getWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600
): Promise<T> {
  if (isRedisReady()) {
    try {
      // 1. Intentar buscar en Redis
      const cachedData = await redis.get(key);
      if (cachedData) {
        return JSON.parse(cachedData) as T;
      }
    } catch (error) {
      if (errorMessage(error) !== 'Connection is closed') {
        console.warn('[cache] Aviso leyendo de Redis:', errorMessage(error) || error);
      }
    }
  }

  // 2. Si no está en caché o Redis falló, buscamos los datos en el origen
  const freshData = await fetcher();

  if (isRedisReady()) {
    try {
      // 3. Guardar en Redis para la próxima consulta
      await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
    } catch (error) {
      if (errorMessage(error) !== 'Connection is closed') {
        console.warn('[cache] Aviso escribiendo en Redis:', errorMessage(error) || error);
      }
    }
  }

  return freshData;
}

/**
 * Invalida (borra) una o más claves de cache tras una mutación (create/update/
 * delete), para que el próximo GET no sirva un valor stale hasta que venza el
 * TTL — el patrón SWR de arriba está pensado para lecturas puras, así que
 * cualquier endpoint que cachea una lista/detalle Y tiene un endpoint de
 * escritura hermano debe llamar esto al final de cada mutación exitosa.
 * Best-effort: nunca lanza (un fallo de invalidación no debe romper la
 * mutación que ya se aplicó en la base de datos).
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
  if (keys.length === 0 || !isRedisReady()) return;
  try {
    await redis.del(...keys);
  } catch (error) {
    if (errorMessage(error) !== 'Connection is closed') {
      console.warn('[cache] invalidateCache falló:', errorMessage(error) || error);
    }
  }
}

/**
 * Igual que invalidateCache, pero para cuando las keys a borrar no son un
 * conjunto fijo enumerable (ej. `budgets:{tenantId}:{subscriptionId}`, donde
 * subscriptionId puede ser cualquier GUID de Azure, no un enum chico como los
 * períodos de Cost Groups). Usa KEYS (no SCAN) porque el volumen de keys de
 * esta app es chico y esto solo corre en el path de una mutación puntual, no
 * en el hot path de lectura — si el dataset creciera mucho, migrar a SCAN.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  if (!isRedisReady()) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch (error) {
    if (errorMessage(error) !== 'Connection is closed') {
      console.warn('[cache] invalidateCachePattern falló:', errorMessage(error) || error);
    }
  }
}

/**
 * Las 3 variantes de período que cachea GET /api/cost-groups
 * (`cost-groups:v1:{tenantId}:{period}`) — cualquier endpoint que mute un
 * Cost Group (crear/editar/eliminar/ajustar Resource Groups manuales) debe
 * invalidar las 3, no solo la que esté mirando el usuario que hizo el
 * cambio, porque otra pestaña/usuario puede estar en un período distinto.
 */
export function costGroupsCacheKeys(tenantId: string): string[] {
  return ["30d", "90d", "fy"].map((p) => `cost-groups:v2:${tenantId}:${p}`);
}

// In-flight de revalidaciones para deduplicar refreshes concurrentes: si N
// requests llegan mientras se está revalidando, todos comparten la misma
// promesa de background y nadie dispara un fetch redundante.
const _inFlight = new Map<string, Promise<unknown>>();

/**
 * Patrón Stale-While-Revalidate (SWR) con soft + hard TTL.
 *
 *  - 0 .. softTtl       → devuelve cache, NO revalida (valores estables).
 *  - softTtl .. ttl     → devuelve cache + dispara revalidación en background
 *                          (deduplicada por key).
 *  - > ttl              → cache expira en Redis; próximo hit es bloqueante.
 *
 * Esto evita que cada refresh del usuario pegue al origen, manteniendo
 * latencia <10ms y valores consistentes entre refreshes cercanos.
 *
 * @param key Clave única para el caché
 * @param fetcher Función que obtiene los datos nuevos
 * @param ttl Tiempo total de vida del cache en segundos (default 1h)
 * @param softTtl Edad a partir de la cual se revalida en background (default 50% de ttl)
 */
export async function getWithStaleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600,
  softTtl?: number,
  // Permite decidir el TTL en función del dato obtenido (p.ej. cachear un
  // resultado "degradado"/parcial por poco tiempo para no envenenar el cache
  // durante 15 min ante un fallo transitorio). Si devuelve <= 0, no se cachea.
  dynamicTtl?: (data: T) => number
): Promise<T> {
  const soft = typeof softTtl === 'number' ? softTtl : Math.floor(ttl / 2);
  const resolveTtl = (data: T): number =>
    typeof dynamicTtl === 'function' ? dynamicTtl(data) : ttl;

  const revalidate = async () => {
    if (_inFlight.has(key)) return;
    const p = (async () => {
      try {
        const freshData = await fetcher();
        if (!isRedisReady()) return;
        const effTtl = resolveTtl(freshData);
        if (effTtl > 0) {
          const envelope: Envelope<T> = { __sw: true, t: Date.now(), data: freshData };
          await redis.set(key, JSON.stringify(envelope), 'EX', effTtl);
        } else {
          // Resultado no cacheable (p.ej. degradado): borramos cualquier
          // entrada previa para forzar un fetch fresco en la próxima request.
          await redis.del(key).catch(() => {});
        }
      } catch (bgError) {
        if (errorMessage(bgError) !== 'Connection is closed') {
          console.warn(`[SWR] Revalidación fallida en background para key ${key}:`, errorMessage(bgError) || bgError);
        }
      } finally {
        _inFlight.delete(key);
      }
    })();
    _inFlight.set(key, p);
  };

  if (isRedisReady()) {
    try {
      const cachedData = await redis.get(key);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);

        if (isEnvelope<T>(parsed)) {
          const ageS = (Date.now() - parsed.t) / 1000;
          if (ageS < soft) {
            // Cache fresco: NO se revalida. Refreshes consecutivos ven el
            // MISMO valor hasta que el cache sea más viejo que softTtl.
            return parsed.data;
          }
          // Cache stale pero todavía dentro del ttl duro: devolvemos cache y
          // disparamos revalidación en background (deduplicada por key).
          void revalidate();
          return parsed.data;
        }

        // Entrada legacy sin envelope (versión anterior del cache): la usamos
        // pero forzamos una revalidación que reemplazará el formato.
        void revalidate();
        return parsed as T;
      }
    } catch (error) {
      if (errorMessage(error) !== 'Connection is closed') {
        console.warn('[cache] Aviso leyendo de Redis en SWR:', errorMessage(error) || error);
      }
    }
  }

  // Cache miss: fetch sincrónico y guardar.
  const freshData = await fetcher();
  if (isRedisReady()) {
    try {
      const effTtl = resolveTtl(freshData);
      if (effTtl > 0) {
        const envelope: Envelope<T> = { __sw: true, t: Date.now(), data: freshData };
        await redis.set(key, JSON.stringify(envelope), 'EX', effTtl);
      }
    } catch (error) {
      if (errorMessage(error) !== 'Connection is closed') {
        console.warn('[cache] Aviso escribiendo en Redis en SWR:', errorMessage(error) || error);
      }
    }
  }

  return freshData;
}
