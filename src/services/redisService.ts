import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class InMemoryCache {
  private store = new Map<string, { value: string; expiry: number | null }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    let expiry: number | null = null;
    if (mode === 'EX' && typeof duration === 'number') {
      expiry = Date.now() + duration * 1000;
    } else if (mode === 'PX' && typeof duration === 'number') {
      expiry = Date.now() + duration;
    }
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item || !item.expiry) return -1;
    const remainingMs = item.expiry - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  async incrby(key: string, amount: number): Promise<number> {
    const item = this.store.get(key);
    const current = item ? parseInt(item.value, 10) || 0 : 0;
    const newVal = current + amount;
    const expiry = item?.expiry ?? null;
    this.store.set(key, { value: newVal.toString(), expiry });
    return newVal;
  }

  async sadd(key: string, member: string): Promise<number> {
    const item = this.store.get(key);
    const set: Set<string> = item ? new Set(JSON.parse(item.value)) : new Set();
    if (set.has(member)) return 0;
    set.add(member);
    const expiry = item?.expiry ?? null;
    this.store.set(key, { value: JSON.stringify([...set]), expiry });
    return 1;
  }

  async scard(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    try { return new Set(JSON.parse(item.value)).size; } catch { return 0; }
  }

  async hincrby(key: string, field: string, amount: number): Promise<number> {
    const item = this.store.get(key);
    const hash: Record<string, number> = item ? JSON.parse(item.value) : {};
    hash[field] = (hash[field] || 0) + amount;
    const expiry = item?.expiry ?? null;
    this.store.set(key, { value: JSON.stringify(hash), expiry });
    return hash[field];
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const item = this.store.get(key);
    if (!item) return null;
    try {
      const parsed = JSON.parse(item.value) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch { return null; }
  }

  async keys(pattern: string): Promise<string[]> {
    const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    const regex = new RegExp(regexStr);
    const now = Date.now();
    return [...this.store.entries()]
      .filter(([k, v]) => regex.test(k) && (!v.expiry || v.expiry > now))
      .map(([k]) => k);
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    this.store.set(key, { ...item, expiry: Date.now() + seconds * 1000 });
    return 1;
  }
}

class CacheService {
  private redisClient: InstanceType<typeof Redis> | null = null;
  private fallbackCache = new InMemoryCache();
  private isRedisConnected = false;

  constructor() {
    try {
      const client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy() {
          return null; // Stop retrying if Redis is offline
        },
      });

      client.on('connect', () => {
        this.isRedisConnected = true;
        logger.info('[REDIS] Connected to Redis server successfully.');
      });

      client.on('error', (err: Error) => {
        if (this.isRedisConnected) {
          logger.warn(`[REDIS] Connection lost: ${err.message}. Using in-memory fallback cache.`);
        }
        this.isRedisConnected = false;
      });

      this.redisClient = client;
    } catch (err) {
      logger.warn('[REDIS] Client initialization failed. Using in-memory fallback cache.');
      this.isRedisConnected = false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.get(key);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.get(key);
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        if (mode === 'EX' && duration) {
          await this.redisClient.set(key, value, 'EX', duration);
        } else {
          await this.redisClient.set(key, value);
        }
        return 'OK';
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.set(key, value, mode, duration);
  }

  async del(key: string): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.del(key);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.del(key);
  }

  async ttl(key: string): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.ttl(key);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.ttl(key);
  }

  async incrby(key: string, amount: number): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.incrby(key, amount);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.incrby(key, amount);
  }

  async sadd(key: string, member: string): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.sadd(key, member);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.sadd(key, member);
  }

  async scard(key: string): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.scard(key);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.scard(key);
  }

  async hincrby(key: string, field: string, amount: number): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.hincrby(key, field, amount);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.hincrby(key, field, amount);
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const result = await this.redisClient.hgetall(key);
        return (result && Object.keys(result).length > 0) ? result : null;
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.hgetall(key);
  }

  async keys(pattern: string): Promise<string[]> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.keys(pattern);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.keys(pattern);
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.expire(key, seconds);
      } catch (err) {
        this.isRedisConnected = false;
      }
    }
    return this.fallbackCache.expire(key, seconds);
  }
}

export const redis = new CacheService();
