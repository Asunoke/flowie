import { GuildMember, TextChannel, EmbedBuilder } from 'discord.js';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from './embedService.js';
import { config } from '../config/index.js';

export interface WarnResult {
  warnCount: number;
  escalationAction: 'NONE' | 'MUTED' | 'BANNED';
  escalationReason?: string;
}

export type ModCaseType =
  | 'WARN'
  | 'MUTE'
  | 'UNMUTE'
  | 'KICK'
  | 'BAN'
  | 'UNBAN'
  | 'SOFTBAN'
  | 'SLOWMODE'
  | 'NICKNAME'
  | 'PURGE_USER';

export class ModerationService {
  /**
   * Check if a moderator has higher role hierarchy than the target member.
   * Server owner can moderate anyone. No one can moderate themselves.
   */
  static checkRoleHierarchy(
    moderatorMember: GuildMember,
    targetMember: GuildMember
  ): { allowed: boolean; reason?: string } {
    // 1. Self check
    if (moderatorMember.id === targetMember.id) {
      return {
        allowed: false,
        reason: 'Vous ne pouvez pas appliquer une sanction sur vous-même.',
      };
    }

    // 2. Server owner check
    if (moderatorMember.guild.ownerId === moderatorMember.id) {
      return { allowed: true };
    }

    // 3. Target is server owner
    if (targetMember.guild.ownerId === targetMember.id) {
      return {
        allowed: false,
        reason: 'Vous ne pouvez pas sanctionner le propriétaire du serveur.',
      };
    }

    // 4. Role position comparison
    const modPosition = moderatorMember.roles.highest.position;
    const targetPosition = targetMember.roles.highest.position;

    if (targetPosition >= modPosition) {
      return {
        allowed: false,
        reason: `Vous ne pouvez pas sanctionner **${targetMember.user.tag}** car son rôle le plus haut (\`${targetMember.roles.highest.name}\`) est supérieur ou égal au vôtre.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Create a moderation case record in DB and send a log to the mod log channel
   */
  static async createCase(
    guildId: string,
    targetId: string,
    moderatorId: string,
    type: ModCaseType,
    reason: string = 'Aucune raison spécifiée',
    guild?: any
  ) {
    try {
      // 1. Save case in DB
      let modCase = null;
      if (prisma.moderationCase) {
        modCase = await prisma.moderationCase.create({
          data: {
            guildId,
            targetId,
            moderatorId,
            type,
            reason,
          },
        });
      }

      // 2. Dispatch log to mod log channel
      const typeLabel: Record<string, string> = {
        WARN: '⚠️ Avertissement',
        MUTE: '🔇 Exclusion temporaire (Mute)',
        UNMUTE: '🔊 Fin d\'exclusion (Unmute)',
        KICK: '🚪 Expulsion (Kick)',
        BAN: '🚨 Bannissement (Ban)',
        UNBAN: '🟢 Débannissement (Unban)',
        SOFTBAN: '🧹 Softban (Bannir & Débannir)',
        SLOWMODE: '⏱️ Mode Lent (Slowmode)',
        NICKNAME: '🏷️ Modification de pseudo',
        PURGE_USER: '🗑️ Purge de messages utilisateur',
      };

      const caseIdStr = modCase ? ` (Dossier #${modCase.id.slice(0, 8)})` : '';
      const logEmbed = EmbedService.create(
        `🛡️ Action de modération — ${typeLabel[type] || type}${caseIdStr}`,
        `**Cible** : <@${targetId}> (\`${targetId}\`)\n**Modérateur** : <@${moderatorId}>\n**Raison** : ${reason}`,
        config.bot.colors.warning
      );

      if (guild) {
        await this.sendModLog(guildId, logEmbed, guild);
      }

      return modCase;
    } catch (err) {
      logger.error({ err, guildId, targetId, type }, 'Failed to create moderation case');
      return null;
    }
  }

  /**
   * Get a moderation case by ID or prefix
   */
  static async getCaseById(guildId: string, caseIdInput: string) {
    try {
      if (!prisma.moderationCase) return null;

      const exact = await prisma.moderationCase.findUnique({
        where: { id: caseIdInput },
      });
      if (exact && exact.guildId === guildId) return exact;

      // Prefix match
      const cases = await prisma.moderationCase.findMany({
        where: { guildId },
      });
      return cases.find((c: any) => c.id.startsWith(caseIdInput)) || null;
    } catch (err) {
      logger.error({ err, caseIdInput }, 'Failed to fetch moderation case');
      return null;
    }
  }

  /**
   * Get all moderation cases for a member in a guild
   */
  static async getMemberCases(guildId: string, targetId: string) {
    try {
      if (!prisma.moderationCase) return [];

      return await prisma.moderationCase.findMany({
        where: { guildId, targetId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (err) {
      logger.error({ err, targetId }, 'Failed to fetch member moderation cases');
      return [];
    }
  }

  /**
   * Send a log entry to the guild's configured mod log channel
   */
  static async sendModLog(guildId: string, embed: EmbedBuilder, guild: any) {
    try {
      const guildConfig = await prisma.guild.findUnique({
        where: { id: guildId },
      });

      if (!guildConfig || !guildConfig.logChannelId) return;

      const channel = guild.channels?.cache?.get(guildConfig.logChannelId) ||
        (await guild.channels?.fetch?.(guildConfig.logChannelId).catch(() => null));

      if (channel && channel instanceof TextChannel) {
        await channel.send({ embeds: [embed] }).catch(() => null);
      }
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to dispatch mod log');
    }
  }

  /**
   * Issue a warning to a member, store in DB, and execute automatic escalation thresholds
   */
  static async issueWarning(
    guildId: string,
    targetMember: GuildMember,
    moderatorId: string,
    reason: string
  ): Promise<WarnResult> {
    let guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guildConfig) {
      guildConfig = await prisma.guild.create({ data: { id: guildId } });
    }

    await prisma.member.upsert({
      where: { guildId_userId: { guildId, userId: targetMember.id } },
      create: { guildId, userId: targetMember.id },
      update: {},
    });

    await prisma.warning.create({
      data: {
        guildId,
        userId: targetMember.id,
        moderatorId,
        reason,
      },
    });

    // Create a ModerationCase record
    await this.createCase(
      guildId,
      targetMember.id,
      moderatorId,
      'WARN',
      reason,
      targetMember.guild
    );

    const warnCount = await prisma.warning.count({
      where: { guildId, userId: targetMember.id },
    });

    let escalationAction: 'NONE' | 'MUTED' | 'BANNED' = 'NONE';
    let escalationReason: string | undefined = undefined;

    if (warnCount >= guildConfig.warnThresholdBan) {
      escalationAction = 'BANNED';
      escalationReason = `Escalade automatique: ${warnCount} avertissements atteints (Seuil: ${guildConfig.warnThresholdBan})`;
      if (targetMember.bannable) {
        await targetMember.ban({ reason: escalationReason }).catch(() => null);
        await this.createCase(
          guildId,
          targetMember.id,
          moderatorId,
          'BAN',
          escalationReason,
          targetMember.guild
        );
      }
    } else if (warnCount >= guildConfig.warnThresholdMute) {
      escalationAction = 'MUTED';
      escalationReason = `Escalade automatique: ${warnCount} avertissements atteints (Seuil: ${guildConfig.warnThresholdMute})`;
      if (targetMember.moderatable) {
        const oneHourMs = 60 * 60 * 1000;
        await targetMember.timeout(oneHourMs, escalationReason).catch(() => null);
        await this.createCase(
          guildId,
          targetMember.id,
          moderatorId,
          'MUTE',
          escalationReason,
          targetMember.guild
        );
      }
    }

    return {
      warnCount,
      escalationAction,
      escalationReason,
    };
  }

  static async getMemberWarnings(guildId: string, userId: string) {
    return prisma.warning.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async clearWarnings(guildId: string, userId: string) {
    return prisma.warning.deleteMany({
      where: { guildId, userId },
    });
  }
}
