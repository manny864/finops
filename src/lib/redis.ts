import Redis from 'ioredis';

const redisClientFactory = () => {
  const host = process.env.REDIS_HOST === 'localhost' ? 'redis' : (process.env.REDIS_HOST || 'redis');
  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
};

type RedisClientType = ReturnType<typeof redisClientFactory>;

const globalForRedis = globalThis as unknown as { redis: RedisClientType | undefined };

export const redis = globalForRedis.redis ?? redisClientFactory();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
