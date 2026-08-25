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
}

export const redis = new CacheService();
