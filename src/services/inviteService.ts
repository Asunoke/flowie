import {
  Guild,
  GuildMember,
  PermissionFlagsBits,
  Client,
  AuditLogEvent,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { logger } from '../utils/logger.js';

export interface InviteStats {
  realInvites: number;
  fakeInvites: number;
  totalJoins: number;
  bonus: number;
  totalValid: number;
}

export interface LeaderboardEntry {
  userId: string;
  realInvites: number;
  fakeInvites: number;
  bonus: number;
  totalValid: number;
}

interface CachedInviteEntry {
  uses: number;
  inviterId: string | null;
}

type InviteCache = Record<string, CachedInviteEntry>;

/**
 * Returns the Redis cache key for a guild's invite cache (stored as JSON)
 */
function inviteCacheKey(guildId: string) {
  return `invite:cache:${guildId}`;
}

function vanityKey(guildId: string) {
  return `invite:vanity:${guildId}`;
}

export class InviteService {
  /**
   * Caches current invite links and usage counts in Redis for a guild (stored as a single JSON blob)
   */
  static async cacheGuildInvites(guild: Guild): Promise<boolean> {
    try {
      const botMember = guild.members.me;
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
        logger.debug(
          `[INVITES] Cannot fetch invites for ${guild.name} (${guild.id}): Missing ManageGuild permission.`
        );
        return false;
      }

      const invites = await guild.invites.fetch().catch((err) => {
        logger.debug({ err }, `[INVITES] Failed to fetch invites for guild ${guild.id}`);
        return null;
      });

      if (invites) {
        const cacheData: InviteCache = {};
        invites.forEach((inv) => {
          cacheData[inv.code] = {
            uses: inv.uses || 0,
            inviterId: inv.inviter?.id || null,
          };
        });
        await redis.set(inviteCacheKey(guild.id), JSON.stringify(cacheData));
      }

      // Cache Vanity URL uses if present
      const vanityData = await guild.fetchVanityData().catch(() => null);
      if (vanityData) {
        await redis.set(vanityKey(guild.id), (vanityData.uses || 0).toString());
      }

      return true;
    } catch (err) {
      logger.error({ err }, `[INVITES] Error caching invites for guild ${guild.id}`);
      return false;
    }
  }

  /**
   * Starts a periodic background refresh of cached invites across all guilds (every 10 min)
   */
  static startPeriodicRefresh(client: Client) {
    setInterval(async () => {
      logger.info('[INVITES] Running periodic invite cache refresh...');
      for (const [, guild] of client.guilds.cache) {
        await this.cacheGuildInvites(guild);
      }
    }, 10 * 60 * 1000);
  }

  /**
   * Tracks a new member join by comparing current invites against Redis cache
   */
  static async trackMemberJoin(guild: Guild, member: GuildMember) {
    try {
      const botMember = guild.members.me;
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return;
      }

      const currentInvites = await guild.invites.fetch().catch(() => null);
      const cachedRaw = await redis.get(inviteCacheKey(guild.id));
      const cachedVanity = await redis.get(vanityKey(guild.id));
      const currentVanity = await guild.fetchVanityData().catch(() => null);

      let usedCode: string | null = null;
      let inviterId: string | null = null;
      let joinType: 'normal' | 'vanity' | 'widget' | 'unknown' = 'unknown';

      const cachedHash: InviteCache = cachedRaw ? (JSON.parse(cachedRaw) as InviteCache) : {};

      // 1. Check Vanity URL usage increase
      if (currentVanity && cachedVanity) {
        const previousVanityUses = parseInt(cachedVanity, 10);
        if ((currentVanity.uses || 0) > previousVanityUses) {
          joinType = 'vanity';
          usedCode = currentVanity.code || 'vanity';
        }
      }

      // 2. Compare current invites against cached invite counts
      if (joinType === 'unknown' && currentInvites) {
        for (const [, inv] of currentInvites) {
          const cachedEntry = cachedHash[inv.code];
          const cachedUses = cachedEntry ? cachedEntry.uses : 0;

          if ((inv.uses || 0) > cachedUses) {
            usedCode = inv.code;
            inviterId = inv.inviter?.id || null;
            joinType = 'normal';
            break;
          }
        }
      }

      // 3. Fallback for 1-use invite that expired & dissolved upon join
      if (joinType === 'unknown' && currentInvites && Object.keys(cachedHash).length > 0) {
        for (const [cachedCode, cachedData] of Object.entries(cachedHash)) {
          if (!currentInvites.has(cachedCode)) {
            usedCode = cachedCode;
            inviterId = cachedData.inviterId;
            joinType = 'normal';
            break;
          }
        }
      }

      // 4. Fallback Audit Log check if still unknown
      if (joinType === 'unknown') {
        const auditLogs = await guild
          .fetchAuditLogs({
            type: AuditLogEvent.InviteDelete,
            limit: 3,
          })
          .catch(() => null);

        if (auditLogs) {
          const recentLog = auditLogs.entries.find(
            (entry) => Date.now() - entry.createdTimestamp < 30000
          );
          if (recentLog) {
            inviterId = recentLog.executorId;
            joinType = 'normal';
          }
        }
      }

      // Save record in DB
      await prisma.inviteJoin.create({
        data: {
          guildId: guild.id,
          memberId: member.id,
          inviterId,
          inviteCode: usedCode,
          joinType,
          leftEarly: false,
        },
      });

      // Update Redis Cache
      await this.cacheGuildInvites(guild);
    } catch (err) {
      logger.error(
        { err },
        `[INVITES] Error tracking member join for ${member.user.tag} in guild ${guild.id}`
      );
    }
  }

  /**
   * Tracks member leave and marks `leftEarly = true` if departed within 10 minutes of joining
   */
  static async trackMemberLeave(guildId: string, memberId: string) {
    try {
      const joinRecord = await prisma.inviteJoin.findFirst({
        where: { guildId, memberId },
        orderBy: { joinedAt: 'desc' },
      });

      if (!joinRecord) return;

      const timeElapsedMs = Date.now() - joinRecord.joinedAt.getTime();
      const tenMinutesMs = 10 * 60 * 1000;

      if (timeElapsedMs < tenMinutesMs) {
        await prisma.inviteJoin.update({
          where: { id: joinRecord.id },
          data: { leftEarly: true },
        });
        logger.info(
          `[INVITES] Member ${memberId} left early (${Math.round(timeElapsedMs / 1000)}s after joining). Marked leftEarly = true.`
        );
      }
    } catch (err) {
      logger.error({ err }, `[INVITES] Error tracking member leave for ${memberId}`);
    }
  }

  /**
   * Computes invite statistics for a specific user in a guild
   */
  static async getMemberInvites(guildId: string, userId: string): Promise<InviteStats> {
    const realInvites = await prisma.inviteJoin.count({
      where: { guildId, inviterId: userId, leftEarly: false, joinType: 'normal' },
    });

    const fakeInvites = await prisma.inviteJoin.count({
      where: { guildId, inviterId: userId, leftEarly: true },
    });

    const totalJoins = await prisma.inviteJoin.count({
      where: { guildId, inviterId: userId },
    });

    const bonusRecord = await prisma.inviteBonus.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    const bonus = bonusRecord ? bonusRecord.amount : 0;
    const totalValid = realInvites + bonus;

    return {
      realInvites,
      fakeInvites,
      totalJoins,
      bonus,
      totalValid,
    };
  }

  /**
   * Retrieves paginated leaderboard of top inviters on the guild
   */
  static async getLeaderboard(
    guildId: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<{ entries: LeaderboardEntry[]; totalPages: number }> {
    const groupedJoins = await prisma.inviteJoin.groupBy({
      by: ['inviterId'],
      where: {
        guildId,
        inviterId: { not: null },
        leftEarly: false,
        joinType: 'normal',
      },
      _count: { inviterId: true },
    });

    const groupedFakes = await prisma.inviteJoin.groupBy({
      by: ['inviterId'],
      where: {
        guildId,
        inviterId: { not: null },
        leftEarly: true,
      },
      _count: { inviterId: true },
    });

    const bonuses = await prisma.inviteBonus.findMany({ where: { guildId } });

    const statsMap = new Map<string, LeaderboardEntry>();

    for (const item of groupedJoins) {
      if (!item.inviterId) continue;
      statsMap.set(item.inviterId, {
        userId: item.inviterId,
        realInvites: item._count.inviterId,
        fakeInvites: 0,
        bonus: 0,
        totalValid: item._count.inviterId,
      });
    }

    for (const item of groupedFakes) {
      if (!item.inviterId) continue;
      const existing = statsMap.get(item.inviterId) ?? {
        userId: item.inviterId,
        realInvites: 0,
        fakeInvites: 0,
        bonus: 0,
        totalValid: 0,
      };
      existing.fakeInvites = item._count.inviterId;
      statsMap.set(item.inviterId, existing);
    }

    for (const b of bonuses) {
      const existing = statsMap.get(b.userId) ?? {
        userId: b.userId,
        realInvites: 0,
        fakeInvites: 0,
        bonus: 0,
        totalValid: 0,
      };
      existing.bonus = b.amount;
      existing.totalValid = existing.realInvites + b.amount;
      statsMap.set(b.userId, existing);
    }

    const allEntries = Array.from(statsMap.values()).sort((a, b) => b.totalValid - a.totalValid);
    const totalPages = Math.ceil(allEntries.length / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const entries = allEntries.slice(startIndex, startIndex + pageSize);

    return { entries, totalPages };
  }

  /**
   * Adds or updates a manual bonus/malus for a member
   */
  static async addBonus(guildId: string, userId: string, amount: number, reason?: string) {
    return prisma.inviteBonus.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, amount, reason },
      update: {
        amount: { increment: amount },
        reason: reason ?? undefined,
      },
    });
  }

  /**
   * Finds who invited a specific member
   */
  static async getWhoInvited(guildId: string, memberId: string) {
    return prisma.inviteJoin.findFirst({
      where: { guildId, memberId },
      orderBy: { joinedAt: 'desc' },
    });
  }

  /**
   * Resets invites for a specific user or the entire guild
   */
  static async resetInvites(guildId: string, userId?: string) {
    if (userId) {
      await prisma.inviteJoin.deleteMany({ where: { guildId, inviterId: userId } });
      await prisma.inviteBonus.deleteMany({ where: { guildId, userId } });
    } else {
      await prisma.inviteJoin.deleteMany({ where: { guildId } });
      await prisma.inviteBonus.deleteMany({ where: { guildId } });
      await redis.del(inviteCacheKey(guildId));
      await redis.del(vanityKey(guildId));
    }
  }
}
