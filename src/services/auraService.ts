import { Guild, ColorResolvable, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from './embedService.js';
import { GuildConfigService } from './guildConfigService.js';

export interface EndorseResult {
  success: boolean;
  reason?: 'self_endorse' | 'disabled' | 'invalid_quality' | 'pair_cooldown' | 'daily_limit' | 'error';
  remainingSec?: number;
  dailyLimit?: number;
  totalScore?: number;
  currentTier?: { name: string; minScore: number; colorHex: string };
  quality?: string;
}

export class AuraService {
  /**
   * Default qualities for a guild if none configured
   */
  static DEFAULT_QUALITIES = ['Fiable', 'Créatif', 'Drôle', 'Serviable', 'Sage'];

  /**
   * Default tiers for a guild if none configured
   */
  static DEFAULT_TIERS = [
    { name: 'Étincelle', minScore: 0, colorHex: '#9CA3AF' },
    { name: 'Lueur', minScore: 10, colorHex: '#38BDF8' },
    { name: 'Éclat', minScore: 30, colorHex: '#3B82F6' },
    { name: 'Rayonnement', minScore: 70, colorHex: '#F59E0B' },
    { name: 'Transcendance', minScore: 150, colorHex: '#8B5CF6' },
  ];

  /**
   * Ensure default qualities and tiers exist for a guild
   */
  static async ensureDefaults(guildId: string) {
    const qualitiesCount = await prisma.auraQuality.count({ where: { guildId } });
    if (qualitiesCount === 0) {
      await prisma.auraQuality.createMany({
        data: this.DEFAULT_QUALITIES.map((name) => ({ guildId, name })),
        skipDuplicates: true,
      });
    }

    const tiersCount = await prisma.auraTier.count({ where: { guildId } });
    if (tiersCount === 0) {
      await prisma.auraTier.createMany({
        data: this.DEFAULT_TIERS.map((tier) => ({
          guildId,
          name: tier.name,
          minScore: tier.minScore,
          colorHex: tier.colorHex,
        })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Get list of qualities for a guild
   */
  static async getQualities(guildId: string): Promise<string[]> {
    await this.ensureDefaults(guildId);
    const qualities = await prisma.auraQuality.findMany({
      where: { guildId },
      select: { name: true },
    });
    return qualities.map((q: { name: string }) => q.name);
  }

  /**
   * Get list of tiers for a guild ordered by minScore asc
   */
  static async getTiers(guildId: string) {
    await this.ensureDefaults(guildId);
    return await prisma.auraTier.findMany({
      where: { guildId },
      orderBy: { minScore: 'asc' },
    });
  }

  /**
   * Endorse a member
   */
  static async endorseMember(
    guild: Guild,
    fromUserId: string,
    toUserId: string,
    qualityInput: string
  ): Promise<EndorseResult> {
    const guildId = guild.id;

    // 1. Cannot self-endorse
    if (fromUserId === toUserId) {
      return { success: false, reason: 'self_endorse' };
    }

    // 2. Check guild module configuration
    const dbGuild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (dbGuild && dbGuild.auraEnabled === false) {
      return { success: false, reason: 'disabled' };
    }

    const dailyLimit = dbGuild?.auraDailyLimit ?? 5;
    const cooldownHours = dbGuild?.auraPairCooldownHours ?? 24;

    // 3. Verify quality exists
    const validQualities = await this.getQualities(guildId);
    const quality = validQualities.find(
      (q) => q.toLowerCase() === qualityInput.trim().toLowerCase()
    );

    if (!quality) {
      return { success: false, reason: 'invalid_quality' };
    }

    const now = new Date();

    // 4. Pair Cooldown Check (fromUserId -> toUserId)
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const lastPairEndorsement = await prisma.endorsement.findFirst({
      where: { guildId, fromUserId, toUserId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastPairEndorsement) {
      const elapsed = now.getTime() - lastPairEndorsement.createdAt.getTime();
      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        return { success: false, reason: 'pair_cooldown', remainingSec };
      }
    }

    // 5. Daily Limit Check (fromUserId in last 24h)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailyCount = await prisma.endorsement.count({
      where: {
        guildId,
        fromUserId,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    if (dailyCount >= dailyLimit) {
      return { success: false, reason: 'daily_limit', dailyLimit };
    }

    // 6. Create Endorsement
    await prisma.endorsement.create({
      data: {
        guildId,
        fromUserId,
        toUserId,
        quality,
      },
    });

    // 7. Reciprocity Suspicion Check (Log to Mod Log if detected)
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const reciprocalCount = await prisma.endorsement.count({
      where: {
        guildId,
        fromUserId: toUserId,
        toUserId: fromUserId,
        createdAt: { gte: fortyEightHoursAgo },
      },
    });

    if (reciprocalCount >= 3) {
      const guildConfig = await GuildConfigService.getGuildConfig(guildId);
      if (guildConfig.logChannelId) {
        try {
          const logChannel = await guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
          if (logChannel && logChannel.isTextBased()) {
            const warningEmbed = EmbedService.warning(
              '⚠️ Signalement Anti-Abus — Réciprocite Aura',
              `Détection de réciprocité d'endorsement élevée entre <@${fromUserId}> et <@${toUserId}> (${reciprocalCount} échanges en 48h).`
            ).setFooter({ text: 'Système Aura • Revue de modération recommandée' });

            await (logChannel as TextChannel).send({ embeds: [warningEmbed] }).catch(() => null);
          }
        } catch (err) {
          logger.warn({ err, guildId }, '[AURA] Failed to send reciprocity alert to mod logs');
        }
      }
    }

    // 8. Sync member tier role dynamically
    const { totalScore, currentTier } = await this.syncMemberTierRole(guild, toUserId);

    return {
      success: true,
      totalScore,
      currentTier,
      quality,
    };
  }

  /**
   * Sync and assign dynamic Aura Tier role to a member
   */
  static async syncMemberTierRole(guild: Guild, userId: string) {
    const guildId = guild.id;

    // Total Score
    const totalScore = await prisma.endorsement.count({
      where: { guildId, toUserId: userId },
    });

    // Get Tiers sorted by minScore desc
    const tiers = await prisma.auraTier.findMany({
      where: { guildId },
      orderBy: { minScore: 'desc' },
    });

    const activeTiers = tiers.length > 0 ? tiers : this.DEFAULT_TIERS.map((t) => ({ ...t, id: '', guildId, roleId: null }));
    const currentTier = activeTiers.find((t: any) => totalScore >= t.minScore) || activeTiers[activeTiers.length - 1];

    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && currentTier) {
        // Ensure role exists in Discord
        let targetRoleId = currentTier.roleId;

        if (targetRoleId) {
          const existingRole = guild.roles.cache.get(targetRoleId);
          if (!existingRole) targetRoleId = null;
        }

        if (!targetRoleId) {
          const newRole = await guild.roles.create({
            name: `Aura — ${currentTier.name}`,
            color: (currentTier.colorHex || '#3B82F6') as ColorResolvable,
            reason: 'Création automatique du rôle de palier Aura',
          });
          targetRoleId = newRole.id;

          if (currentTier.id) {
            await prisma.auraTier.update({
              where: { id: currentTier.id },
              data: { roleId: targetRoleId },
            });
          }
        }

        // Assign target role if not already possessed
        if (!member.roles.cache.has(targetRoleId)) {
          await member.roles.add(targetRoleId).catch(() => null);
        }

        // Remove any OTHER aura tier roles from member
        const allTierRoleIds = activeTiers.map((t: any) => t.roleId).filter((id: any): id is string => Boolean(id) && id !== targetRoleId);
        for (const oldRoleId of allTierRoleIds) {
          if (member.roles.cache.has(oldRoleId)) {
            await member.roles.remove(oldRoleId).catch(() => null);
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId, userId }, '[AURA] Error syncing tier role for member');
    }

    return { totalScore, currentTier };
  }

  /**
   * Get full Aura Profile for a member
   */
  static async getAuraProfile(guildId: string, userId: string) {
    await this.ensureDefaults(guildId);

    const totalScore = await prisma.endorsement.count({
      where: { guildId, toUserId: userId },
    });

    const qualities = await this.getQualities(guildId);
    const tiers = await this.getTiers(guildId);

    // Current Tier & Next Tier
    const currentTier = [...tiers].reverse().find((t: any) => totalScore >= t.minScore) || tiers[0];
    const nextTier = tiers.find((t: any) => t.minScore > totalScore) || null;

    let progressPercent = 100;
    if (nextTier) {
      const prevMin = currentTier ? currentTier.minScore : 0;
      const range = nextTier.minScore - prevMin;
      const gained = totalScore - prevMin;
      progressPercent = range > 0 ? Math.min(100, Math.floor((gained / range) * 100)) : 100;
    }

    // Breakdown per Quality
    const qualityCounts = await prisma.endorsement.groupBy({
      by: ['quality'],
      where: { guildId, toUserId: userId },
      _count: { _all: true },
    });

    const breakdownMap = new Map<string, number>();
    for (const q of qualities) breakdownMap.set(q, 0);
    for (const qc of qualityCounts) breakdownMap.set(qc.quality, qc._count._all);

    const breakdown = Array.from(breakdownMap.entries()).map(([name, count]) => {
      const percent = totalScore > 0 ? Math.round((count / totalScore) * 100) : 0;
      const barLength = Math.round(percent / 10); // 0 to 10 blocks
      const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
      return { name, count, percent, bar };
    });

    // Recent Endorsers (last 5)
    const recentEndorsements = await prisma.endorsement.findMany({
      where: { guildId, toUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      totalScore,
      currentTier,
      nextTier,
      progressPercent,
      breakdown,
      recentEndorsements,
    };
  }

  /**
   * Get Aura Leaderboard
   */
  static async getLeaderboard(guildId: string, qualityFilter?: string, limit = 10) {
    await this.ensureDefaults(guildId);

    const whereCondition: any = { guildId };
    if (qualityFilter) {
      const qualities = await this.getQualities(guildId);
      const match = qualities.find((q) => q.toLowerCase() === qualityFilter.trim().toLowerCase());
      if (match) whereCondition.quality = match;
    }

    const grouped = await prisma.endorsement.groupBy({
      by: ['toUserId'],
      where: whereCondition,
      _count: { _all: true },
      orderBy: {
        _count: {
          toUserId: 'desc',
        },
      },
      take: limit,
    });

    const tiers = await this.getTiers(guildId);

    const leaderboard = grouped.map((g: any, idx: number) => {
      const score = g._count._all;
      const currentTier = [...tiers].reverse().find((t: any) => score >= t.minScore) || tiers[0];
      return {
        rank: idx + 1,
        userId: g.toUserId,
        score,
        tierName: currentTier ? currentTier.name : 'Inconnu',
      };
    });

    return leaderboard;
  }
}
