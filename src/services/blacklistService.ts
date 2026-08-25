import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { logger } from '../utils/logger.js';

export class BlacklistService {
  /**
   * Check if a user or a guild is blacklisted (with Redis caching)
   */
  static async isBlacklisted(
    userId: string,
    guildId?: string | null
  ): Promise<{ blacklisted: boolean; reason?: string; type?: string }> {
    try {
      // 1. Check User Blacklist in Redis
      const userCache = await redis.get(`blacklist:user:${userId}`);
      if (userCache) {
        return { blacklisted: true, reason: userCache, type: 'user' };
      }

      // 2. Check Guild Blacklist in Redis
      if (guildId) {
        const guildCache = await redis.get(`blacklist:guild:${guildId}`);
        if (guildCache) {
          return { blacklisted: true, reason: guildCache, type: 'guild' };
        }
      }

      // 3. Fallback DB Query if not in Redis
      if (!prisma.blacklist) return { blacklisted: false };

      const userEntry = await prisma.blacklist.findUnique({
        where: { targetId: userId },
      });

      if (userEntry) {
        await redis.set(`blacklist:user:${userId}`, userEntry.reason, 'EX', 300);
        return { blacklisted: true, reason: userEntry.reason, type: 'user' };
      }

      if (guildId) {
        const guildEntry = await prisma.blacklist.findUnique({
          where: { targetId: guildId },
        });

        if (guildEntry) {
          await redis.set(`blacklist:guild:${guildId}`, guildEntry.reason, 'EX', 300);
          return { blacklisted: true, reason: guildEntry.reason, type: 'guild' };
        }
      }

      return { blacklisted: false };
    } catch (err) {
      logger.error({ err, userId, guildId }, '[BLACKLIST] Error checking blacklist status');
      return { blacklisted: false };
    }
  }

  /**
   * Add a user or guild to the blacklist
   */
  static async addBlacklist(type: 'user' | 'guild', targetId: string, reason: string = 'Aucune raison spécifiée') {
    try {
      const entry = await prisma.blacklist.upsert({
        where: { targetId },
        create: { type, targetId, reason },
        update: { reason },
      });

      // Update Redis cache
      await redis.set(`blacklist:${type}:${targetId}`, reason, 'EX', 300);
      logger.info(`[BLACKLIST] Added ${type} ${targetId} to blacklist: "${reason}"`);
      return entry;
    } catch (err) {
      logger.error({ err, type, targetId }, '[BLACKLIST] Error adding to blacklist');
      return null;
    }
  }

  /**
   * Remove a user or guild from the blacklist
   */
  static async removeBlacklist(targetId: string) {
    try {
      const deleted = await prisma.blacklist.delete({
        where: { targetId },
      }).catch(() => null);

      await redis.del(`blacklist:user:${targetId}`);
      await redis.del(`blacklist:guild:${targetId}`);

      logger.info(`[BLACKLIST] Removed ${targetId} from blacklist`);
      return deleted;
    } catch (err) {
      logger.error({ err, targetId }, '[BLACKLIST] Error removing from blacklist');
      return null;
    }
  }

  /**
   * Get all blacklist entries
   */
  static async getBlacklistEntries() {
    try {
      return await prisma.blacklist.findMany({
        orderBy: { addedAt: 'desc' },
      });
    } catch (err) {
      logger.error({ err }, '[BLACKLIST] Error listing blacklist entries');
      return [];
    }
  }
}
