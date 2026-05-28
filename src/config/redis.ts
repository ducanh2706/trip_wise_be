import Redis from 'ioredis';
import { env } from '@/config/env';

let redisClient: Redis | null = null;
let redisDisabledLogged = false;

function ensureRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (!env.redisUrl) {
    if (!redisDisabledLogged) {
      console.log('[redis] REDIS_URL is empty, detail cache disabled');
      redisDisabledLogged = true;
    }
    return null;
  }

  const client = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    enableAutoPipelining: true,
  });
  client.on('error', (error) => {
    console.error('[redis] error:', error);
  });
  client.on('connect', () => {
    console.log('[redis] connected');
  });
  redisClient = client;
  return client;
}

export async function getCacheJson<T>(key: string): Promise<T | null> {
  const client = ensureRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[redis] get cache failed for key "${key}":`, error);
    return null;
  }
}

export async function setCacheJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const client = ensureRedisClient();
  if (!client) return;
  try {
    const payload = JSON.stringify(value);
    await client.set(key, payload, 'EX', ttlSeconds);
  } catch (error) {
    console.error(`[redis] set cache failed for key "${key}":`, error);
  }
}

export async function deleteCacheKey(key: string): Promise<void> {
  const client = ensureRedisClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch (error) {
    console.error(`[redis] delete cache failed for key "${key}":`, error);
  }
}

