import { EmbedBuilder, TextChannel, Message } from 'discord.js';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface EmbedFieldData {
  name: string;
  value: string;
  inline?: boolean;
}

export interface CustomEmbedData {
  title?: string;
  description?: string;
  color?: string; // Hex code, e.g., "#0B3D2E" or "#D4AF37"
  imageUrl?: string;
  thumbnailUrl?: string;
  footerText?: string;
  fields?: EmbedFieldData[];
}

export class EmbedBuilderService {
  /**
   * Converts CustomEmbedData into a formatted Discord EmbedBuilder
   */
  static buildEmbed(data: CustomEmbedData): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);

    // Parse Color (Hex or default Flowie Primary)
    if (data.color) {
      const cleanHex = data.color.replace('#', '');
      const hexNum = parseInt(cleanHex, 16);
      if (!isNaN(hexNum)) {
        embed.setColor(hexNum);
      } else {
        embed.setColor(config.bot.colors.primary);
      }
    } else {
      embed.setColor(config.bot.colors.primary);
    }

    if (data.imageUrl && /^https?:\/\//.test(data.imageUrl)) {
      embed.setImage(data.imageUrl);
    }

    if (data.thumbnailUrl && /^https?:\/\//.test(data.thumbnailUrl)) {
      embed.setThumbnail(data.thumbnailUrl);
    }

    const footer = data.footerText ? `${data.footerText} • ${config.bot.signature}` : config.bot.signature;
    embed.setFooter({ text: footer });

    if (data.fields && Array.isArray(data.fields)) {
      for (const f of data.fields) {
        if (f.name && f.value) {
          embed.addFields({
            name: f.name,
            value: f.value,
            inline: f.inline ?? false,
          });
        }
      }
    }

    return embed;
  }

  /**
   * Saves a reusable embed template in DB
   */
  static async saveTemplate(
    guildId: string,
    name: string,
    embedData: CustomEmbedData,
    createdBy: string
  ) {
    const cleanName = name.trim().toLowerCase();
    return prisma.embedTemplate.upsert({
      where: { guildId_name: { guildId, name: cleanName } },
      create: {
        guildId,
        name: cleanName,
        embedData: embedData as any,
        createdBy,
      },
      update: {
        embedData: embedData as any,
        createdBy,
      },
    });
  }

  /**
   * Retrieves a saved embed template from DB
   */
  static async getTemplate(guildId: string, name: string) {
    const cleanName = name.trim().toLowerCase();
    return prisma.embedTemplate.findUnique({
      where: { guildId_name: { guildId, name: cleanName } },
    });
  }

  /**
   * Lists all saved embed templates for a guild
   */
  static async listTemplates(guildId: string) {
    return prisma.embedTemplate.findMany({
      where: { guildId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Deletes a saved embed template from DB
   */
  static async deleteTemplate(guildId: string, name: string): Promise<boolean> {
    const cleanName = name.trim().toLowerCase();
    const res = await prisma.embedTemplate.deleteMany({
      where: { guildId, name: cleanName },
    });
    return res.count > 0;
  }

  /**
   * Edits an existing message sent by Flowie in a channel with new embed data
   */
  static async editBotEmbed(channel: TextChannel, messageId: string, embedData: CustomEmbedData): Promise<Message> {
    const targetMsg = await channel.messages.fetch(messageId).catch(() => null);
    if (!targetMsg) {
      throw new Error(`Message \`${messageId}\` introuvable dans ce salon.`);
    }

    if (targetMsg.author.id !== channel.client.user?.id) {
      throw new Error('Vous ne pouvez modifier que les messages envoyés par Flowie.');
    }

    const embed = this.buildEmbed(embedData);
    return targetMsg.edit({ embeds: [embed] });
  }
}
