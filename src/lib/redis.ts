import Redis from 'ioredis';

const redisClientFactory = () => {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    commandTimeout: 2000,
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
