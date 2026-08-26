import {
  Guild,
  GuildMember,
  VoiceChannel,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  CategoryChannel,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';

// Map to hold pending deletion timeouts (10 seconds)
const deletionTimeouts = new Map<string, NodeJS.Timeout>();

export class TempVoiceService {
  /**
   * Retrieves TempVoiceSettings for a guild
   */
  static async getSettings(guildId: string) {
    return prisma.tempVoiceSettings.findUnique({
      where: { guildId },
    });
  }

  /**
   * Saves or updates TempVoiceSettings in DB
   */
  static async saveSettings(data: {
    guildId: string;
    triggerChannelId: string;
    categoryId: string;
    nameTemplate?: string;
    maxChannels?: number;
    enabled: boolean;
  }) {
    return prisma.tempVoiceSettings.upsert({
      where: { guildId: data.guildId },
      create: {
        guildId: data.guildId,
        triggerChannelId: data.triggerChannelId,
        categoryId: data.categoryId,
        nameTemplate: data.nameTemplate ?? '🔊 Salon de {user}',
        maxChannels: data.maxChannels ?? 50,
        enabled: data.enabled,
      },
      update: {
        triggerChannelId: data.triggerChannelId,
        categoryId: data.categoryId,
        nameTemplate: data.nameTemplate ?? '🔊 Salon de {user}',
        maxChannels: data.maxChannels ?? 50,
        enabled: data.enabled,
      },
    });
  }

  /**
   * Disables temp voice module for a guild
   */
  static async disableTempVoice(guildId: string) {
    return prisma.tempVoiceSettings.update({
      where: { guildId },
      data: { enabled: false },
    });
  }

  /**
   * Retrieves a TempVoiceChannel DB record by channelId
   */
  static async getTempChannel(channelId: string) {
    return prisma.tempVoiceChannel.findUnique({
      where: { channelId },
    });
  }

  /**
   * Retrieves a member's active temp voice channel record in a guild
   */
  static async getMemberTempChannel(guildId: string, ownerId: string) {
    return prisma.tempVoiceChannel.findFirst({
      where: { guildId, ownerId },
    });
  }

  /**
   * Creates a new temporary voice channel and moves the member into it
   */
  static async createTempChannel(
    guild: Guild,
    member: GuildMember
  ): Promise<{
    success: boolean;
    channel?: VoiceChannel;
    existingChannelId?: string;
    reason?: 'already_exists' | 'disabled' | 'limit_reached' | 'error';
    limit?: number;
  }> {
    try {
      // 1. Check if member already has an active temp channel
      const existingRecord = await this.getMemberTempChannel(guild.id, member.id);
      if (existingRecord) {
        const existingChannel = guild.channels.cache.get(existingRecord.channelId);
        if (existingChannel && existingChannel.isVoiceBased()) {
          // Move member to their existing channel if connected
          if (member.voice.channelId) {
            await member.voice.setChannel(existingChannel as VoiceChannel).catch(() => null);
          }
          return { success: false, existingChannelId: existingRecord.channelId, reason: 'already_exists' };
        } else {
          // Clean up stale DB record if channel no longer exists
          await prisma.tempVoiceChannel.delete({ where: { channelId: existingRecord.channelId } }).catch(() => null);
        }
      }

      // 2. Fetch settings
      const settings = await this.getSettings(guild.id);
      if (!settings || !settings.enabled) {
        return { success: false, reason: 'disabled' };
      }

      // 3. Check guild channel limit
      const currentCount = await prisma.tempVoiceChannel.count({
        where: { guildId: guild.id },
      });

      if (currentCount >= settings.maxChannels) {
        return { success: false, reason: 'limit_reached', limit: settings.maxChannels };
      }

      // 4. Format channel name
      const displayName = member.displayName || member.user.username;
      const rawTemplate = settings.nameTemplate || '🔊 Salon de {user}';
      const channelName = rawTemplate.replace(/{user}/g, displayName);

      // 5. Create Voice Channel
      const category = guild.channels.cache.get(settings.categoryId);
      const parentId = category && category instanceof CategoryChannel ? category.id : settings.categoryId;

      const voiceChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: parentId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
          },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
        reason: `Salon vocal temporaire créé pour ${member.user.tag}`,
      });

      // 6. Save in DB
      await prisma.tempVoiceChannel.create({
        data: {
          guildId: guild.id,
          channelId: voiceChannel.id,
          ownerId: member.id,
        },
      });

      // 7. Move member to the new voice channel
      if (member.voice.channelId) {
        await member.voice.setChannel(voiceChannel).catch((err) => {
          logger.warn({ err }, `Could not move member ${member.user.tag} to temp voice channel ${voiceChannel.id}`);
        });
      }

      // 8. Send control panel embed in DM
      await this.sendControlPanel(member, voiceChannel);

      return { success: true, channel: voiceChannel };
    } catch (err) {
      logger.error({ err }, 'Error in TempVoiceService.createTempChannel');
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Sends the control panel embed with action buttons to the owner (DM)
   */
  static async sendControlPanel(member: GuildMember, channel: VoiceChannel) {
    try {
      const embed = EmbedService.create(
        '🔊 Panneau de Contrôle Salon Vocal',
        `Votre salon vocal **${channel.name}** a été créé avec succès !\n\nUtilisez les boutons ci-dessous ou les commandes \`/voice ...\` pour gérer votre salon.`
      ).addFields(
        { name: '🔒 Verrouiller', value: '`/voice lock` / `/voice unlock`', inline: true },
        { name: '✏️ Renommer', value: '`/voice rename <nom>`', inline: true },
        { name: '👥 Limite', value: '`/voice limit <nombre>`', inline: true },
        { name: '⛔ Bloquer/Expulser', value: '`/voice kick` / `/voice reject`', inline: true },
        { name: '👑 Transférer', value: '`/voice transfer <membre>`', inline: true },
        { name: '🙋 Réclamer', value: '`/voice claim`', inline: true }
      );

      const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tempvoice_lock:${channel.id}`).setLabel('Verrouiller').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
        new ButtonBuilder().setCustomId(`tempvoice_unlock:${channel.id}`).setLabel('Déverrouiller').setStyle(ButtonStyle.Success).setEmoji('🔓'),
        new ButtonBuilder().setCustomId(`tempvoice_rename:${channel.id}`).setLabel('Renommer').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
        new ButtonBuilder().setCustomId(`tempvoice_limit:${channel.id}`).setLabel('Limite').setStyle(ButtonStyle.Primary).setEmoji('👥'),
        new ButtonBuilder().setCustomId(`tempvoice_claim:${channel.id}`).setLabel('Réclamer').setStyle(ButtonStyle.Danger).setEmoji('👑')
      );

      await member.send({ embeds: [embed], components: [row1] }).catch(() => {
        logger.debug(`Could not send DM control panel to ${member.user.tag}`);
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to send control panel DM');
    }
  }

  /**
   * Schedules channel deletion if empty (10 seconds delay)
   */
  static async scheduleChannelDeletion(channel: VoiceChannel) {
    const channelId = channel.id;

    // Clear any existing timer
    this.cancelChannelDeletion(channelId);

    const timeout = setTimeout(async () => {
      deletionTimeouts.delete(channelId);

      try {
        const fetchedChannel = await channel.guild.channels.fetch(channelId).catch(() => null);
        if (fetchedChannel && fetchedChannel.isVoiceBased() && fetchedChannel.members.size === 0) {
          await fetchedChannel.delete('Salon vocal temporaire vide').catch(() => null);
          await prisma.tempVoiceChannel.deleteMany({ where: { channelId } }).catch(() => null);
          logger.info(`Cleaned up empty temp voice channel ${channelId} in guild ${channel.guild.id}`);
        }
      } catch (err) {
        logger.error({ err }, `Error during scheduled deletion of channel ${channelId}`);
      }
    }, 10000); // 10 seconds

    deletionTimeouts.set(channelId, timeout);
  }

  /**
   * Cancels scheduled channel deletion if someone rejoins
   */
  static cancelChannelDeletion(channelId: string) {
    const existing = deletionTimeouts.get(channelId);
    if (existing) {
      clearTimeout(existing);
      deletionTimeouts.delete(channelId);
    }
  }

  /**
   * Cleans up orphaned or empty temp channels from DB on bot boot
   */
  static async cleanupOrphanedChannels(client: Client) {
    try {
      const records = await prisma.tempVoiceChannel.findMany();
      logger.info(`[TEMP VOICE] Auditing ${records.length} stored temporary channels on boot...`);

      for (const record of records) {
        try {
          const guild = client.guilds.cache.get(record.guildId);
          if (!guild) {
            await prisma.tempVoiceChannel.delete({ where: { id: record.id } }).catch(() => null);
            continue;
          }

          const channel = await guild.channels.fetch(record.channelId).catch(() => null);
          if (!channel || !channel.isVoiceBased()) {
            await prisma.tempVoiceChannel.delete({ where: { id: record.id } }).catch(() => null);
          } else if (channel.members.size === 0) {
            await channel.delete('Salon temporaire orphelin au démarrage').catch(() => null);
            await prisma.tempVoiceChannel.delete({ where: { id: record.id } }).catch(() => null);
          }
        } catch (err) {
          logger.warn({ err, recordId: record.id }, 'Error cleaning up temp voice channel record');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error during TempVoiceService.cleanupOrphanedChannels');
    }
  }

  /**
   * Checks if member is owner of the temp channel or a staff member
   */
  static async isOwnerOrStaff(guild: Guild, member: GuildMember, channelId: string): Promise<boolean> {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    const guildConfig = await prisma.guild.findUnique({ where: { id: guild.id } });
    if (guildConfig?.ticketStaffRoleId && member.roles.cache.has(guildConfig.ticketStaffRoleId)) {
      return true;
    }

    const tempRecord = await this.getTempChannel(channelId);
    if (!tempRecord) return false;

    return tempRecord.ownerId === member.id;
  }

  // ─── CONTROL FUNCTIONS ────────────────────────────────────────────────────

  static async renameChannel(channel: VoiceChannel, newName: string) {
    return channel.setName(newName);
  }

  static async setLimit(channel: VoiceChannel, limit: number) {
    return channel.setUserLimit(limit);
  }

  static async setLocked(channel: VoiceChannel, locked: boolean) {
    return channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
      Connect: !locked,
    });
  }

  static async kickMember(channel: VoiceChannel, targetMember: GuildMember) {
    if (targetMember.voice.channelId === channel.id) {
      await targetMember.voice.disconnect('Expulsé du salon temporaire par le propriétaire');
    }
    return channel.permissionOverwrites.edit(targetMember, {
      Connect: false,
    });
  }

  static async permitMember(channel: VoiceChannel, targetMember: GuildMember) {
    return channel.permissionOverwrites.edit(targetMember, {
      Connect: true,
      ViewChannel: true,
    });
  }

  static async rejectMember(channel: VoiceChannel, targetMember: GuildMember) {
    if (targetMember.voice.channelId === channel.id) {
      await targetMember.voice.disconnect('Bloqué du salon temporaire');
    }
    return channel.permissionOverwrites.edit(targetMember, {
      Connect: false,
    });
  }

  static async transferOwnership(
    guild: Guild,
    channel: VoiceChannel,
    newOwnerMember: GuildMember
  ) {
    const record = await this.getTempChannel(channel.id);
    if (!record) return false;

    // Update DB
    await prisma.tempVoiceChannel.update({
      where: { channelId: channel.id },
      data: { ownerId: newOwnerMember.id },
    });

    // Remove old owner manage permissions if present
    const oldOwner = await guild.members.fetch(record.ownerId).catch(() => null);
    if (oldOwner) {
      await channel.permissionOverwrites.delete(oldOwner).catch(() => null);
    }

    // Grant new owner manage permissions
    await channel.permissionOverwrites.edit(newOwnerMember, {
      Connect: true,
      ViewChannel: true,
      ManageChannels: true,
      MuteMembers: true,
      DeafenMembers: true,
      MoveMembers: true,
    });

    return true;
  }

  static async claimOwnership(
    guild: Guild,
    channel: VoiceChannel,
    claimerMember: GuildMember
  ): Promise<{ success: boolean; reason?: 'not_eligible' | 'already_owner' }> {
    const record = await this.getTempChannel(channel.id);
    if (!record) return { success: false, reason: 'not_eligible' };

    if (record.ownerId === claimerMember.id) {
      return { success: false, reason: 'already_owner' };
    }

    // Check if original owner is still inside the voice channel
    const ownerInChannel = channel.members.has(record.ownerId);
    if (ownerInChannel) {
      return { success: false, reason: 'not_eligible' };
    }

    // Transfer ownership
    await this.transferOwnership(guild, channel, claimerMember);
    return { success: true };
  }
}
