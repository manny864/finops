import { redis } from './redis';

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
  try {
    // 1. Intentar buscar en Redis
    const cachedData = await redis.get(key);
    
    if (cachedData) {
      return JSON.parse(cachedData) as T;
    }
  } catch (error) {
    // Si Redis falla, registramos el error pero no rompemos la app
    console.error('Error leyendo de Redis:', error);
  }

  // 2. Si no está en caché o Redis falló, buscamos los datos en el origen
  const freshData = await fetcher();

  try {
    // 3. Guardar en Redis para la próxima consulta
    await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
  } catch (error) {
    console.error('Error escribiendo en Redis:', error);
  }

  return freshData;
}

/**
 * Patrón Stale-While-Revalidate (SWR): 
 * Devuelve caché inmediatamente (latencia <10ms) y revalida en background sin bloquear.
 * Ideal para SaaS con dashboards pesados en Node.js.
 * @param key Clave única para el caché
 * @param fetcher Función que obtiene los datos nuevos
 * @param ttl Tiempo de vida del caché en segundos
 */
export async function getWithStaleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600
): Promise<T> {
  try {
    // 1. Intentar buscar en Redis
    const cachedData = await redis.get(key);
    
    if (cachedData) {
      // SWR: Data existe. Disparar fetch de background desconectado
      (async () => {
        try {
          const freshData = await fetcher();
          await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
        } catch (bgError) {
          console.error(`[SWR] Revalidación fallida en background para key ${key}:`, bgError);
        }
      })();
      
      // Retornar cache instantáneamente
      return JSON.parse(cachedData) as T;
    }
  } catch (error) {
    console.error('Error leyendo de Redis en SWR:', error);
  }

  // Si no hay caché (Cache Miss), esperar sincrónicamente
  const freshData = await fetcher();
  try {
    await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
  } catch (error) {
    console.error('Error escribiendo en Redis en SWR:', error);
  }

  return freshData;
}
