import Redis from 'ioredis';

/**
 * Cuánto esperar (ms) antes del reintento nº `times` de reconectar, o `null` para rendirse.
 *
 * En producción NUNCA se rinde. Con `null` ioredis deja de reconectar PARA SIEMPRE, así que un
 * corte de Redis de más de ~1,2 s (mantenimiento o failover de Azure Managed Redis; hubo 2 resets
 * `ECONNRESET` en 14 días de logs) dejaba a esa réplica sin caché hasta que alguien la reiniciara:
 * todas las rutas SWR pegaban directo a MySQL y a Azure.
 *
 * Fuera de producción se conserva el tope de 3 intentos: sin un Redis local el proceso tiene que
 * poder terminar (los tests corren con `REDIS_PORT=1` a propósito, y los reintentos eternos
 * mantendrían vivo el event loop).
 */
export function estrategiaDeReintento(times: number, enProduccion: boolean): number | null {
  if (!enProduccion) return times > 3 ? null : Math.min(times * 200, 1000);
  return Math.min(times * 200, 2000);
}

const redisClientFactory = () => {
  const host = process.env.REDIS_HOST || '127.0.0.1';

  // Azure Cache for Redis sólo acepta TLS (puerto 6380) y exige password.
  // El Redis del VPS corre en claro en la red interna de Docker, así que esto
  // va por variable de entorno en vez de deducirse del puerto: un contenedor
  // local con TLS forzado no conectaría, y un Azure Cache sin TLS tampoco.
  // Terraform inyecta REDIS_TLS=true junto con el host y el password.
  const useTls = process.env.REDIS_TLS === 'true';

  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT) || (useTls ? 6380 : 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    // `servername` explícito: sin él, la validación del certificado falla en
    // los casos donde ioredis no infiere el SNI del host.
    //
    // minVersion y rejectUnauthorized también explícitos, igual que en
    // src/modules/storage/db.ts: rejectUnauthorized ya es true por defecto en Node,
    // pero la validación del certificado es un límite de confianza y no se deja
    // librada a un default que un cambio de librería podría mover. Azure Managed
    // Redis exige TLS 1.2 como mínimo (verificado en prod el 2026-10-10).
    tls: useTls ? { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    maxRetriesPerRequest: null,
    // El handshake TLS suma un round-trip y Azure Cache está a más latencia
    // que un contenedor en el mismo host: 2s dejaba la conexión al borde.
    connectTimeout: useTls ? 10000 : 2000,
    commandTimeout: useTls ? 5000 : 2000,
    enableOfflineQueue: false,
    retryStrategy: (times) => estrategiaDeReintento(times, process.env.NODE_ENV === 'production')
  });
};

type RedisClientType = ReturnType<typeof redisClientFactory>;

const globalForRedis = globalThis as unknown as { redis: RedisClientType | undefined };

export const redis = globalForRedis.redis ?? redisClientFactory();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
