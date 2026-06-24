import Redis from 'ioredis';

const redisClientFactory = () => {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
};

type RedisClientType = ReturnType<typeof redisClientFactory>;

const globalForRedis = globalThis as unknown as { redis: RedisClientType | undefined };

export const redis = globalForRedis.redis ?? redisClientFactory();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
