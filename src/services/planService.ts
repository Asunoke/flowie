import { Guild } from 'discord.js';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';

export interface QuotaInfo {
  userId: string;
  isPremium: boolean;
  maxGuilds: number; // -1 = unlimited, 1 = Free default
  activeCount: number;
  allowed: boolean;
  expiresAt?: Date | null;
}

export class PlanService {
  /**
   * Fetch user's premium status and active guilds quota
   */
  static async getQuotaInfo(userId: string): Promise<QuotaInfo> {
    try {
      let maxGuilds = 1;
      let isPremium = false;
      let expiresAt: Date | null = null;

      if (prisma.premiumWhitelist) {
        const whitelist = await prisma.premiumWhitelist.findUnique({
          where: { userId },
        });

        if (whitelist) {
          // Check expiration
          if (whitelist.expiresAt && whitelist.expiresAt < new Date()) {
            logger.info({ userId }, '[PLAN] Premium status expired for user');
          } else {
            maxGuilds = whitelist.maxGuilds;
            isPremium = maxGuilds > 1 || maxGuilds === -1;
            expiresAt = whitelist.expiresAt;
          }
        }
      }

      // Count active (non-locked) guilds owned by / associated with this user
      const activeCount = await prisma.guild.count({
        where: { ownerUserId: userId, isLocked: false },
      });

      const allowed = maxGuilds === -1 || activeCount < maxGuilds;

      return {
        userId,
        isPremium,
        maxGuilds,
        activeCount,
        allowed,
        expiresAt,
      };
    } catch (err) {
      logger.error({ err, userId }, '[PLAN] Error fetching quota info');
      return {
        userId,
        isPremium: false,
        maxGuilds: 1,
        activeCount: 1,
        allowed: false,
      };
    }
  }

  /**
   * Add or update a user's premium whitelist status
   */
  static async addPremium(
    userId: string,
    maxGuilds: number,
    addedBy: string,
    durationDays?: number,
    reason: string = 'Ajouté par le staff'
  ) {
    try {
      const expiresAt = durationDays
        ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
        : null;

      const entry = await prisma.premiumWhitelist.upsert({
        where: { userId },
        create: { userId, maxGuilds, addedBy, reason, expiresAt },
        update: { maxGuilds, addedBy, reason, expiresAt },
      });

      logger.info(`[PLAN] User ${userId} upgraded to maxGuilds=${maxGuilds} by ${addedBy}`);
      return entry;
    } catch (err) {
      logger.error({ err, userId }, '[PLAN] Error adding premium entry');
      return null;
    }
  }

  /**
   * Remove premium status for a user (resets to Free 1 guild max)
   */
  static async removePremium(userId: string) {
    try {
      const deleted = await prisma.premiumWhitelist.delete({
        where: { userId },
      }).catch(() => null);

      logger.info(`[PLAN] User ${userId} removed from premium whitelist`);
      return deleted;
    } catch (err) {
      logger.error({ err, userId }, '[PLAN] Error removing premium entry');
      return null;
    }
  }

  /**
   * Validate new guild addition during guildCreate
   */
  static async checkQuotaForNewGuild(guildId: string, ownerUserId: string) {
    const quota = await this.getQuotaInfo(ownerUserId);

    if (quota.allowed) {
      // Activate Guild in DB
      await prisma.guild.upsert({
        where: { id: guildId },
        create: { id: guildId, ownerUserId, isLocked: false },
        update: { ownerUserId, isLocked: false },
      });
      return { allowed: true, ownerUserId, quota };
    } else {
      // Lock Guild in DB
      await prisma.guild.upsert({
        where: { id: guildId },
        create: { id: guildId, ownerUserId, isLocked: true },
        update: { ownerUserId, isLocked: true },
      });
      return { allowed: false, ownerUserId, quota };
    }
  }

  /**
   * Release guild slot when Flowie leaves a server (guildDelete)
   */
  static async handleGuildLeave(guildId: string) {
    try {
      await prisma.guild.delete({
        where: { id: guildId },
      }).catch(() => null);
      logger.info(`[PLAN] Released guild slot for server ${guildId}`);
    } catch (err) {
      logger.error({ err, guildId }, '[PLAN] Error releasing guild slot on leave');
    }
  }
}
