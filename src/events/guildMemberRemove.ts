import { GuildMember, TextChannel, PartialGuildMember, AttachmentBuilder } from 'discord.js';
import { UptimeService } from '../services/uptimerService.js';
import { WelcomeCardService } from '../services/welcomeCardService.js';
import { EmbedService } from '../services/embedService.js';
import { prisma } from '../database/db.js';
import { InviteService } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Handles guildMemberRemove for Uptimer, Leave System, and Invite Tracking (left early check).
 */
export async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember) {
  try {
    const guildId = member.guild.id;

    // 0. Invite Tracking (Check if member left < 10 mins after joining)
    await InviteService.trackMemberLeave(guildId, member.id);

    // 1. Leave System Message & Banner Card
    try {
      const guildConfig = await prisma.guild.findUnique({ where: { id: guildId } });

      if (guildConfig && guildConfig.leaveEnabled && guildConfig.leaveChannelId) {
        const channel = member.guild.channels.cache.get(guildConfig.leaveChannelId);
        if (channel && channel instanceof TextChannel) {
          const rawMsg =
            guildConfig.leaveMessage ||
            '{user} a quitté {server}. Nous sommes désormais {membercount} membres.';
          const tagOrName = member.user ? member.user.tag : 'Un membre';
          const formattedMsg = rawMsg
            .replace(/{user}/g, `**${tagOrName}**`)
            .replace(/{server}/g, member.guild.name)
            .replace(/{membercount}/g, member.guild.memberCount.toString());

          const cardBuffer = await WelcomeCardService.generateLeaveCard(member, guildConfig.leaveBgUrl);
          const attachment = new AttachmentBuilder(cardBuffer, { name: 'leave-card.png' });

          const embed = EmbedService.create('👋 Départ d\'un membre', formattedMsg, config.bot.colors.error)
            .setImage('attachment://leave-card.png');

          await channel.send({ embeds: [embed], files: [attachment] }).catch(() => null);
        }
      }
    } catch (leaveErr) {
      logger.error({ err: leaveErr }, '[LEAVE_SYSTEM] Error sending leave message');
    }

    // 2. Uptimer (Tracked Bot Left)
    if (member.user?.bot) {
      const botId = member.user.id;
      const tracked = await UptimeService.getTrackedBot(guildId, botId);

      if (tracked) {
        await UptimeService.markNotFound(guildId, botId);
        logger.info(`[UPTIMER] Bot ${member.user.tag} (${botId}) left guild ${guildId} — marked as not_found`);

        if (tracked.alertChannelId) {
          try {
            const channel = member.guild.channels.cache.get(tracked.alertChannelId);
            if (channel && channel instanceof TextChannel) {
              const embed = EmbedService.create(
                '⚪ Bot introuvable',
                `Le bot **${member.user.tag}** a quitté le serveur.\nSon statut est désormais **Introuvable**.\n\nVous pouvez le retirer du suivi avec \`/uptimer remove\`.`,
                config.bot.colors.warning
              ).setThumbnail(member.user.displayAvatarURL({ size: 64 }));

              await channel.send({ embeds: [embed] }).catch(() => null);
            }
          } catch (err) {
            logger.error({ err }, '[UPTIMER] Error sending not_found alert');
          }
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[EVENT] Error in guildMemberRemove handler');
  }
}
