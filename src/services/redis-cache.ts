import { Redis } from "ioredis";

export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
}

export class RedisJsonCache {
  public constructor(private readonly redis: Redis) {}
  public async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) as T : null;
  }
  public async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }
}
