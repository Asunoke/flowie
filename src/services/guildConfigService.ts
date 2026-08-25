import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class GuildConfigService {
  /**
   * Get guild configuration with Redis caching (TTL configurable)
   */
  static async getGuildConfig(guildId: string) {
    const cacheKey = `guild:config:${guildId}`;

    try {
      // 1. Try Redis cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn({ err, guildId }, '[CONFIG_CACHE] Failed to read from Redis, falling back to DB');
    }

    // 2. Fetch from DB or create default
    let guildConfig = await prisma.guild.findUnique({
      where: { id: guildId },
    });

    if (!guildConfig) {
      guildConfig = await prisma.guild.create({
        data: {
          id: guildId,
          language: 'fr',
          currencyName: 'Flow',
          welcomeEnabled: false, // Disabled by default until admin configures
          leaveEnabled: false,   // Disabled by default until admin configures
        },
      });
    }

    // 3. Populate Redis cache
    try {
      const ttl = config.scaling.configCacheTtl || 600;
      await redis.set(cacheKey, JSON.stringify(guildConfig), 'EX', ttl);
    } catch (err) {
      logger.warn({ err, guildId }, '[CONFIG_CACHE] Failed to write to Redis cache');
    }

    return guildConfig;
  }

  /**
   * Update guild configuration in DB and invalidate Redis cache
   */
  static async updateGuildConfig(guildId: string, data: any) {
    const updated = await prisma.guild.update({
      where: { id: guildId },
      data,
    });

    await this.invalidateGuildConfig(guildId);
    return updated;
  }

  /**
   * Invalidate Redis cache for a guild
   */
  static async invalidateGuildConfig(guildId: string) {
    const cacheKey = `guild:config:${guildId}`;
    try {
      await redis.del(cacheKey);
      logger.debug({ guildId }, '[CONFIG_CACHE] Invalidated Redis config cache');
    } catch (err) {
      logger.error({ err, guildId }, '[CONFIG_CACHE] Error invalidating Redis config cache');
    }
  }
}
