import {
  Guild,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class ReportService {
  /**
   * Configures report channel for a guild
   */
  static async setConfig(guildId: string, channelId: string, enabled: boolean = true) {
    return prisma.reportConfig.upsert({
      where: { guildId },
      create: { guildId, channelId, enabled },
      update: { channelId, enabled },
    });
  }

  /**
   * Retrieves report configuration for a guild
   */
  static async getConfig(guildId: string) {
    return prisma.reportConfig.findUnique({
      where: { guildId },
    });
  }

  /**
   * Submits a report discretely to the staff channel
   */
  static async createReport(
    guild: Guild,
    reporterId: string,
    reportedId: string,
    reason: string,
    proofUrl?: string
  ) {
    if (reporterId === reportedId) {
      throw new Error('Vous ne pouvez pas vous signaler vous-même.');
    }

    const conf = await this.getConfig(guild.id);
    if (!conf || !conf.enabled || !conf.channelId) {
      throw new Error('Le système de signalement n\'est pas encore configuré par les administrateurs de ce serveur.');
    }

    const staffChannel = guild.channels.cache.get(conf.channelId);
    if (!staffChannel || !staffChannel.isTextBased() || !('send' in staffChannel)) {
      throw new Error('Le salon de signalement staff est introuvable.');
    }

    // Cooldown check (5 minutes = 300s)
    const cooldownKey = `report:cooldown:${guild.id}:${reporterId}`;
    const remainingTtl = await redis.ttl(cooldownKey);

    if (remainingTtl > 0) {
      const remainingMinutes = Math.ceil(remainingTtl / 60);
      throw new Error(`Veuillez patienter encore **${remainingMinutes} minute(s)** avant de soumettre un nouveau signalement.`);
    }

    const report = await prisma.report.create({
      data: {
        guildId: guild.id,
        reporterId,
        reportedId,
        reason,
        proofUrl: proofUrl || null,
        status: 'pending',
      },
    });

    const embed = EmbedService.warning(
      `🚨 Signalement Membre — #${report.id.slice(-6)}`,
      `Un nouveau signalement a été transmis à l'équipe staff.`
    ).addFields(
      { name: '👤 Membre signalé', value: `<@${reportedId}> (\`${reportedId}\`)`, inline: true },
      { name: '🚩 Auteur du signalement', value: `<@${reporterId}> (\`${reporterId}\`)`, inline: true },
      { name: '📝 Raison', value: `> ${reason}`, inline: false }
    );

    if (proofUrl) {
      embed.addFields({ name: '🖼️ Preuve fournie', value: proofUrl, inline: false });
    }

    embed.setFooter({ text: `${config.bot.signature} • Signalement Staff` }).setTimestamp(report.createdAt);

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_action_warn:${report.id}`)
        .setLabel('Avertir')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⚠️'),
      new ButtonBuilder()
        .setCustomId(`report_action_mute:${report.id}`)
        .setLabel('Muter (1h)')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔇'),
      new ButtonBuilder()
        .setCustomId(`report_action_ignore:${report.id}`)
        .setLabel('Ignorer')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🙈')
    );

    const sentMsg = await (staffChannel as TextChannel).send({ embeds: [embed], components: [actionRow] });

    await prisma.report.update({
      where: { id: report.id },
      data: { messageId: sentMsg.id },
    });

    // Set 5 minute cooldown
    await redis.set(cooldownKey, '1', 'EX', 300);

    return report;
  }

  /**
   * Handles staff quick actions on a report (warn, mute, ignore)
   */
  static async handleReportAction(
    reportId: string,
    staffUserId: string,
    action: 'warn' | 'mute' | 'ignore',
    guild: Guild,
    reportMessage?: Message
  ) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Signalement introuvable.');
    }

    const newStatus = action === 'warn' ? 'warned' : action === 'mute' ? 'muted' : 'ignored';

    await prisma.report.update({
      where: { id: reportId },
      data: { status: newStatus },
    });

    // Execute moderation action if applicable
    if (action === 'warn') {
      await prisma.warning.create({
        data: {
          guildId: guild.id,
          userId: report.reportedId,
          moderatorId: staffUserId,
          reason: `Signalement #${report.id.slice(-6)} : ${report.reason}`,
        },
      }).catch(() => null);
    } else if (action === 'mute') {
      const reportedMember = await guild.members.fetch(report.reportedId).catch(() => null);
      if (reportedMember && reportedMember.moderatable) {
        await reportedMember.timeout(60 * 60 * 1000, `Signalement #${report.id.slice(-6)} : ${report.reason}`).catch(() => null);
      }
    }

    // Update staff report message
    if (reportMessage && reportMessage.embeds.length > 0) {
      const existingEmbed = reportMessage.embeds[0];
      const actionBadge = action === 'warn' ? '⚠️ `Averti`' : action === 'mute' ? '🔇 `Muté (1h)`' : '🙈 `Ignoré`';

      const updatedEmbed = EmbedService.create(
        existingEmbed.title || `🚨 Signalement — #${report.id.slice(-6)}`,
        `**Statut :** ${actionBadge} par <@${staffUserId}>\n\n` +
          `**Membre signalé :** <@${report.reportedId}>\n` +
          `**Raison :** ${report.reason}`
      ).setTimestamp(new Date());

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('d_warn').setLabel('Averti').setStyle(action === 'warn' ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('d_mute').setLabel('Muté').setStyle(action === 'mute' ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('d_ignore').setLabel('Ignoré').setStyle(action === 'ignore' ? ButtonStyle.Secondary : ButtonStyle.Secondary).setDisabled(true)
      );

      await reportMessage.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => null);
    }

    return report;
  }
}
