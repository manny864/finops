import Redis from 'ioredis';

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
    tls: useTls ? { servername: host } : undefined,
    maxRetriesPerRequest: null,
    // El handshake TLS suma un round-trip y Azure Cache está a más latencia
    // que un contenedor en el mismo host: 2s dejaba la conexión al borde.
    connectTimeout: useTls ? 10000 : 2000,
    commandTimeout: useTls ? 5000 : 2000,
    enableOfflineQueue: false,
    retryStrategy: (times) => {
      if (times > 3) return null;
      return Math.min(times * 200, 1000);
    }
  });
};

type RedisClientType = ReturnType<typeof redisClientFactory>;

const globalForRedis = globalThis as unknown as { redis: RedisClientType | undefined };

export const redis = globalForRedis.redis ?? redisClientFactory();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
