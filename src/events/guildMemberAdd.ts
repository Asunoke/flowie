import { GuildMember, TextChannel, AttachmentBuilder } from 'discord.js';
import { prisma } from '../database/db.js';
import { WelcomeCardService } from '../services/welcomeCardService.js';
import { EmbedService } from '../services/embedService.js';
import { InviteService } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
import { redis } from '../services/redisService.js';

export async function handleGuildMemberAdd(member: GuildMember) {
  try {
    // 0. Track Invite Used on Member Join
    await InviteService.trackMemberJoin(member.guild, member);

    const guildConfig = await prisma.guild.findUnique({
      where: { id: member.guild.id },
    });

    if (!guildConfig) return;

    // 1. Anti-Bot Verification Check
    const verifySettings = await prisma.verifySettings.findUnique({
      where: { guildId: member.guild.id },
    });

    if (verifySettings && verifySettings.enabled && verifySettings.unverifiedRoleId) {
      const unverifiedRole = member.guild.roles.cache.get(verifySettings.unverifiedRoleId);
      if (unverifiedRole) {
        await member.roles.add(unverifiedRole).catch((err) => {
          logger.error({ err }, `Failed to assign unverified role ${verifySettings.unverifiedRoleId} to ${member.user.tag}`);
        });
      }
    }

    // 2. Anti-Raid Detection (e.g. > 10 joins in 10 seconds)
    if (guildConfig.antiRaidEnabled) {
      const raidKey = `antiraid:${member.guild.id}`;
      const rawCount = await redis.get(raidKey);
      const joinCount = rawCount ? parseInt(rawCount, 10) : 0;

      if (joinCount >= 10) {
        logger.warn(`🚨 Anti-Raid triggered for guild ${member.guild.name} (${member.guild.id})`);
        // Optionally lock down default text channels or log alert
      } else {
        await redis.set(raidKey, (joinCount + 1).toString(), 'EX', 10);
      }
    }

    // 2. Auto Role Assignment
    if (guildConfig.autoRoleId) {
      const role = member.guild.roles.cache.get(guildConfig.autoRoleId);
      if (role) {
        await member.roles.add(role).catch((err) => {
          logger.error({ err }, `Failed to assign autorole ${guildConfig.autoRoleId} to ${member.user.tag}`);
        });
      }
    }

    // 3. Welcome Message & Banner Card
    if (guildConfig.welcomeEnabled && guildConfig.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(guildConfig.welcomeChannelId);
      if (channel && channel instanceof TextChannel) {
        const rawMsg = guildConfig.welcomeMessage || 'Bienvenue {user} sur {server} ! Nous sommes désormais {membercount} membres.';
        const formattedMsg = rawMsg
          .replace(/{user}/g, `${member}`)
          .replace(/{server}/g, member.guild.name)
          .replace(/{membercount}/g, member.guild.memberCount.toString());

        const cardBuffer = await WelcomeCardService.generateWelcomeCard(member, guildConfig.welcomeBgUrl);
        const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome-card.png' });

        const embed = EmbedService.create('🎉 Nouveau Membre !', formattedMsg)
          .setImage('attachment://welcome-card.png');

        await channel.send({ content: `${member}`, embeds: [embed], files: [attachment] });
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in guildMemberAdd listener');
  }
}
