import {
  Guild,
  GuildMember,
  TextChannel,
  CategoryChannel,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  UserSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class TicketService {
  /**
   * Post a ticket panel in a specific channel.
   */
  static async createTicketPanel(
    guild: Guild,
    channel: TextChannel,
    typesInput?: string | null
  ): Promise<boolean> {
    try {
      const types = typesInput
        ? typesInput
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
        : ['Support'];

      const finalTypes = types.length > 0 ? types : ['Support'];

      const embed = EmbedService.create(
        '🎫 Centre d\'Assistance — Tickets',
        'Besoin d\'aide ou d\'informations ? Ouvrez un ticket ci-dessous pour entrer en contact avec notre équipe.',
        config.bot.colors.primary
      )
        .addFields({
          name: '📋 Types de demande',
          value: finalTypes.map((t) => `• **${t}**`).join('\n'),
        })
        .setFooter({ text: `${guild.name} • Florynx Labs` });

      const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

      if (finalTypes.length > 1) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_create_select')
          .setPlaceholder('Sélectionnez le sujet de votre ticket...')
          .addOptions(
            finalTypes.map((type) => ({
              label: type,
              value: type.substring(0, 100),
              description: `Ouvrir un ticket pour : ${type}`,
              emoji: '🎫',
            }))
          );

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
      } else {
        const button = new ButtonBuilder()
          .setCustomId(`ticket_create_default:${finalTypes[0]}`)
          .setLabel('Ouvrir un ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary);

        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
      }

      await channel.send({ embeds: [embed], components: rows });
      return true;
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Failed to create panel');
      return false;
    }
  }

  /**
   * Open a ticket channel for a member.
   */
  static async openTicket(
    guild: Guild,
    member: GuildMember,
    type: string = 'Support'
  ): Promise<{ success: boolean; channel?: TextChannel; reason?: string; limit?: number }> {
    try {
      let guildConfig = await prisma.guild.findUnique({ where: { id: guild.id } });
      if (!guildConfig) {
        guildConfig = await prisma.guild.create({ data: { id: guild.id } });
      }

      const limit = guildConfig.ticketLimit || 1;

      // Check open tickets count for member
      const openCount = await prisma.ticket.count({
        where: {
          guildId: guild.id,
          ownerId: member.id,
          status: 'open',
        },
      });

      if (openCount >= limit) {
        return { success: false, reason: 'limit_reached', limit };
      }

      // Determine parent category
      let categoryId = guildConfig.ticketCategoryId || undefined;
      if (categoryId) {
        const cat = guild.channels.cache.get(categoryId);
        if (!cat || !(cat instanceof CategoryChannel)) {
          categoryId = undefined;
        }
      }

      // Clean channel name
      const cleanUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
      const channelName = `ticket-${cleanUsername || 'user'}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Setup permission overwrites
      const permissionOverwrites: any[] = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ];

      if (guild.members.me) {
        permissionOverwrites.push({
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
          ],
        });
      }

      if (guildConfig.ticketStaffRoleId) {
        const staffRole = guild.roles.cache.get(guildConfig.ticketStaffRoleId);
        if (staffRole) {
          permissionOverwrites.push({
            id: staffRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          });
        }
      }

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: channelName,
        parent: categoryId,
        permissionOverwrites,
        topic: `Ticket de ${member.user.tag} | Type: ${type} | ID: ${member.id}`,
      });

      // Save ticket in DB
      const ticketRecord = await prisma.ticket.create({
        data: {
          guildId: guild.id,
          channelId: ticketChannel.id,
          ownerId: member.id,
          type,
          status: 'open',
        },
      });

      // Send initial welcome message inside the channel
      const welcomeEmbed = EmbedService.create(
        `🎫 Ticket — ${type}`,
        `Bonjour ${member}, bienvenue dans votre salon d'assistance privé.\nUn membre de l'équipe du staff s'occupera de vous dans les plus brefs délais.`,
        config.bot.colors.primary
      ).addFields(
        { name: '👤 Propriétaire', value: `${member}`, inline: true },
        { name: '🏷️ Type', value: `\`${type}\``, inline: true },
        { name: '📌 Statut', value: '🟢 `Ouvert`', inline: true },
        { name: '🙋‍♂️ Réclamé par', value: '`Aucun`', inline: true }
      );

      const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_close:${ticketRecord.id}`)
          .setLabel('Fermer')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket_claim:${ticketRecord.id}`)
          .setLabel('Réclamer')
          .setEmoji('🙋‍♂️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ticket_add_member:${ticketRecord.id}`)
          .setLabel('Ajouter un membre')
          .setEmoji('👤')
          .setStyle(ButtonStyle.Secondary)
      );

      await ticketChannel.send({
        content: `${member} ${guildConfig.ticketStaffRoleId ? `<@&${guildConfig.ticketStaffRoleId}>` : ''}`,
        embeds: [welcomeEmbed],
        components: [buttonsRow],
      });

      // Log action
      await this.sendLog(guild, guildConfig.ticketLogsChannelId, {
        title: '📥 Nouveau ticket ouvert',
        description: `Un ticket a été ouvert par ${member} dans ${ticketChannel}.`,
        color: config.bot.colors.success,
        fields: [
          { name: 'Propriétaire', value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Type', value: type, inline: true },
          { name: 'Salon', value: `<#${ticketChannel.id}>`, inline: true },
        ],
      });

      return { success: true, channel: ticketChannel };
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error opening ticket');
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Close a ticket channel and generate transcript.
   */
  static async closeTicket(
    channel: TextChannel,
    closedBy: GuildMember,
    reason: string = 'Aucune raison spécifiée'
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { channelId: channel.id },
      });

      if (!ticket || ticket.status === 'closed') {
        return { success: false, reason: 'not_found' };
      }

      const guildConfig = await prisma.guild.findUnique({ where: { id: channel.guild.id } });

      // Permission check: owner can close their own ticket, otherwise staff perm required
      const isOwner = ticket.ownerId === closedBy.id;
      const isStaff =
        closedBy.permissions.has(PermissionFlagsBits.Administrator) ||
        closedBy.permissions.has(PermissionFlagsBits.ManageChannels) ||
        (guildConfig?.ticketStaffRoleId && closedBy.roles.cache.has(guildConfig.ticketStaffRoleId));

      if (!isOwner && !isStaff) {
        return { success: false, reason: 'unauthorized' };
      }

      // Generate Transcript
      const transcriptBuffer = await this.generateTranscript(channel, ticket);
      const fileName = `transcript-ticket-${ticket.id}.html`;
      const attachment = new AttachmentBuilder(transcriptBuffer, { name: fileName });

      // Mark as closed in DB
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedBy: closedBy.id,
          closeReason: reason,
        },
      });

      // Notify in channel before deletion
      const closingEmbed = EmbedService.warning(
        'Fermeture du ticket',
        `Ce ticket a été fermé par ${closedBy}.\n**Raison :** ${reason}\n\nCe salon sera supprimé dans 5 secondes.`
      );
      await channel.send({ embeds: [closingEmbed] }).catch(() => null);

      // Send DM to ticket owner
      try {
        const ownerUser = await channel.client.users.fetch(ticket.ownerId).catch(() => null);
        if (ownerUser) {
          const dmEmbed = EmbedService.create(
            '📄 Transcript de votre ticket',
            `Votre ticket sur **${channel.guild.name}** a été fermé par **${closedBy.user.tag}**.\n**Raison :** ${reason}`,
            config.bot.colors.primary
          ).addFields(
            { name: 'Type', value: ticket.type, inline: true },
            { name: 'Fermé le', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
          );

          await ownerUser.send({
            embeds: [dmEmbed],
            files: [attachment],
          });
        }
      } catch (dmErr) {
        logger.warn(`[TICKET_SERVICE] Could not send DM transcript to ${ticket.ownerId}`);
      }

      // Send Log to ticket logs channel
      await this.sendLog(channel.guild, guildConfig?.ticketLogsChannelId, {
        title: '🔒 Ticket fermé',
        description: `Le ticket de <@${ticket.ownerId}> a été fermé par ${closedBy}.`,
        color: config.bot.colors.error,
        fields: [
          { name: 'Propriétaire', value: `<@${ticket.ownerId}>`, inline: true },
          { name: 'Fermé par', value: `${closedBy}`, inline: true },
          { name: 'Type', value: ticket.type, inline: true },
          { name: 'Raison', value: reason, inline: false },
        ],
        files: [attachment],
      });

      // Schedule deletion of the channel
      setTimeout(() => {
        channel.delete('Ticket fermé').catch((err) => {
          logger.error({ err }, '[TICKET_SERVICE] Error deleting ticket channel');
        });
      }, 5000);

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error closing ticket');
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Claim a ticket.
   */
  static async claimTicket(
    channel: TextChannel,
    staffMember: GuildMember
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { channelId: channel.id },
      });

      if (!ticket || ticket.status === 'closed') {
        return { success: false, reason: 'not_found' };
      }

      const guildConfig = await prisma.guild.findUnique({ where: { id: channel.guild.id } });

      const isStaff =
        staffMember.permissions.has(PermissionFlagsBits.Administrator) ||
        staffMember.permissions.has(PermissionFlagsBits.ManageChannels) ||
        (guildConfig?.ticketStaffRoleId && staffMember.roles.cache.has(guildConfig.ticketStaffRoleId));

      if (!isStaff) {
        return { success: false, reason: 'unauthorized' };
      }

      if (ticket.claimedBy) {
        return { success: false, reason: 'already_claimed' };
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { claimedBy: staffMember.id },
      });

      const claimEmbed = EmbedService.success(
        'Ticket réclamé',
        `Ce ticket est désormais pris en charge par ${staffMember}.`
      );
      await channel.send({ embeds: [claimEmbed] });

      await this.sendLog(channel.guild, guildConfig?.ticketLogsChannelId, {
        title: '🙋‍♂️ Ticket réclamé',
        description: `Le ticket <#${channel.id}> a été réclamé par ${staffMember}.`,
        color: config.bot.colors.info,
        fields: [
          { name: 'Staff', value: `${staffMember.user.tag}`, inline: true },
          { name: 'Propriétaire', value: `<@${ticket.ownerId}>`, inline: true },
        ],
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error claiming ticket');
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Add a member to a ticket channel.
   */
  static async addMemberToTicket(
    channel: TextChannel,
    targetMember: GuildMember,
    executorMember: GuildMember
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { channelId: channel.id },
      });

      if (!ticket || ticket.status === 'closed') {
        return { success: false, reason: 'not_found' };
      }

      await channel.permissionOverwrites.edit(targetMember.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      });

      const embed = EmbedService.success(
        'Membre ajouté',
        `${targetMember} a été ajouté au ticket par ${executorMember}.`
      );
      await channel.send({ embeds: [embed] });

      const guildConfig = await prisma.guild.findUnique({ where: { id: channel.guild.id } });
      await this.sendLog(channel.guild, guildConfig?.ticketLogsChannelId, {
        title: '👤 Membre ajouté au ticket',
        description: `${targetMember} a été ajouté au ticket <#${channel.id}> par ${executorMember}.`,
        color: config.bot.colors.info,
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error adding member to ticket');
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Record first staff response in a ticket channel.
   */
  static async recordFirstResponse(channelId: string, authorId: string) {
    try {
      if (!prisma.ticket) return;

      const ticket = await prisma.ticket.findUnique({
        where: { channelId },
      });

      if (!ticket || ticket.status === 'closed' || ticket.firstResponseAt !== null) {
        return;
      }

      // Ignore response if from ticket owner or bot
      if (ticket.ownerId === authorId) return;

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { firstResponseAt: new Date() },
      });
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error recording first response');
    }
  }

  /**
   * Handle channelDelete event to clean up DB tickets.
   */
  static async handleChannelDelete(channel: TextChannel) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { channelId: channel.id },
      });

      if (!ticket || ticket.status === 'closed') return;

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closeReason: 'Salon supprimé manuellement',
        },
      });

      logger.info(`[TICKET_SERVICE] Marked ticket ${ticket.id} as closed due to channel deletion`);

      const guildConfig = await prisma.guild.findUnique({ where: { id: channel.guild.id } });
      await this.sendLog(channel.guild, guildConfig?.ticketLogsChannelId, {
        title: '⚠️ Ticket fermé (salon supprimé)',
        description: `Le salon de ticket \`${channel.name}\` (<@${ticket.ownerId}>) a été supprimé manuellement.`,
        color: config.bot.colors.warning,
      });
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error handling channel delete');
    }
  }

  /**
   * Compute ticket statistics for a guild.
   */
  static async getTicketStats(guildId: string, period: string = 'all') {
    try {
      let dateFilter: Date | undefined;
      const now = new Date();

      if (period === '24h') {
        dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (period === '7d') {
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === '30d') {
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const whereClause = dateFilter
        ? { guildId, createdAt: { gte: dateFilter } }
        : { guildId };

      const tickets = await prisma.ticket.findMany({
        where: whereClause,
      });

      const total = tickets.length;
      const open = tickets.filter((t: { status: string }) => t.status === 'open').length;
      const closed = tickets.filter((t: { status: string }) => t.status === 'closed').length;

      // Type breakdown
      const typeCounts: Record<string, number> = {};
      tickets.forEach((t: { type: string }) => {
        typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
      });

      // Average first response time
      const responseTimes = tickets
        .filter((t: { firstResponseAt: Date | null }) => t.firstResponseAt !== null)
        .map((t: { firstResponseAt: Date | null; createdAt: Date }) => t.firstResponseAt!.getTime() - t.createdAt.getTime());

      let avgResponseTimeMs = 0;
      if (responseTimes.length > 0) {
        avgResponseTimeMs =
          responseTimes.reduce((acc: number, curr: number) => acc + curr, 0) / responseTimes.length;
      }

      // Staff Leaderboard
      const staffCounts: Record<string, number> = {};
      tickets.forEach((t: { claimedBy: string | null; closedBy: string | null; ownerId: string }) => {
        if (t.claimedBy) {
          staffCounts[t.claimedBy] = (staffCounts[t.claimedBy] || 0) + 1;
        } else if (t.closedBy && t.closedBy !== t.ownerId) {
          staffCounts[t.closedBy] = (staffCounts[t.closedBy] || 0) + 1;
        }
      });

      const staffLeaderboard = Object.entries(staffCounts)
        .map(([staffId, count]) => ({ staffId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        total,
        open,
        closed,
        typeCounts,
        avgResponseTimeMs,
        staffLeaderboard,
      };
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error fetching ticket stats');
      return null;
    }
  }

  /**
   * Utility method to generate HTML transcript.
   */
  private static async generateTranscript(channel: TextChannel, ticket: any): Promise<Buffer> {
    try {
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      const sortedMessages = messages
        ? Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        : [];

      let html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Transcript Ticket ${ticket.id}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 20px; }
    .header { border-bottom: 2px solid #313244; padding-bottom: 15px; margin-bottom: 20px; }
    .header h1 { color: #a6e3a1; margin: 0 0 5px 0; }
    .message { display: flex; margin-bottom: 15px; background: #181825; padding: 10px; border-radius: 8px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 12px; }
    .content { flex-grow: 1; }
    .author { font-weight: bold; color: #89b4fa; }
    .time { font-size: 0.8em; color: #6c7086; margin-left: 8px; }
    .text { margin-top: 4px; line-height: 1.4; word-break: break-word; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Transcript — Ticket ${ticket.type}</h1>
    <p>Salon : #${channel.name} | ID Ticket : ${ticket.id}</p>
    <p>Créé le : ${ticket.createdAt.toLocaleString('fr-FR')}</p>
  </div>
  <div class="messages">
`;

      for (const msg of sortedMessages) {
        const avatarUrl = msg.author.displayAvatarURL({ size: 64 });
        const timeStr = msg.createdAt.toLocaleString('fr-FR');
        const contentEscaped = msg.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;\n');

        html += `    <div class="message">
      <img class="avatar" src="${avatarUrl}" alt="avatar">
      <div class="content">
        <span class="author">${msg.author.tag}</span>
        <span class="time">${timeStr}</span>
        <div class="text">${contentEscaped || '<i>[Message sans texte / média]</i>'}</div>
      </div>
    </div>\n`;
      }

      html += `  </div>
</body>
</html>`;

      return Buffer.from(html, 'utf-8');
    } catch (err) {
      logger.error({ err }, '[TICKET_SERVICE] Error generating transcript HTML');
      return Buffer.from(`Transcript for ticket ${ticket.id}\nCould not fetch messages.`, 'utf-8');
    }
  }

  /**
   * Helper to send log messages to configured ticket logs channel.
   */
  private static async sendLog(
    guild: Guild,
    logChannelId: string | null | undefined,
    options: {
      title: string;
      description: string;
      color: number;
      fields?: { name: string; value: string; inline?: boolean }[];
      files?: AttachmentBuilder[];
    }
  ) {
    if (!logChannelId) return;

    try {
      const channel = guild.channels.cache.get(logChannelId);
      if (channel && channel instanceof TextChannel) {
        const embed = EmbedService.create(options.title, options.description, options.color);
        if (options.fields) embed.addFields(options.fields);

        await channel.send({
          embeds: [embed],
          files: options.files || [],
        }).catch(() => null);
      }
    } catch (error) {
      logger.error({ err: error }, '[TICKET_SERVICE] Error sending log');
    }
  }
}
