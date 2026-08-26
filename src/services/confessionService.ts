import { Client, TextChannel, Guild } from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const FORBIDDEN_PATTERNS = [
  /discord\.gg\/[a-zA-Z0-9]+/i,
  /discord\.com\/invite\/[a-zA-Z0-9]+/i,
  /https?:\/\/[^\s]+/i, // Disallow links in anonymous confessions to prevent phishing
];

export class ConfessionService {
  /**
   * Checks if content violates AutoMod rules (links, forbidden patterns)
   */
  static isAutoModBlocked(content: string): boolean {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) return true;
    }
    return false;
  }

  /**
   * Configures confession channel for a guild
   */
  static async setConfig(guildId: string, channelId: string, enabled: boolean = true) {
    return prisma.confessionConfig.upsert({
      where: { guildId },
      create: { guildId, channelId, enabled },
      update: { channelId, enabled },
    });
  }

  /**
   * Retrieves confession configuration for a guild
   */
  static async getConfig(guildId: string) {
    return prisma.confessionConfig.findUnique({
      where: { guildId },
    });
  }

  /**
   * Posts an anonymous confession
   */
  static async submitConfession(
    guild: Guild,
    authorId: string,
    content: string
  ): Promise<{ number: number; messageId: string }> {
    const conf = await this.getConfig(guild.id);
    if (!conf || !conf.enabled || !conf.channelId) {
      throw new Error('Le système de confessions anonymes n\'est pas configuré ou activé sur ce serveur.');
    }

    const channel = guild.channels.cache.get(conf.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error('Le salon de confessions configuré est introuvable.');
    }

    // 1. AutoMod Filter Check
    if (this.isAutoModBlocked(content)) {
      throw new Error('Votre message contient du contenu interdit (liens ou publicité). La confession a été bloquée par l\'AutoMod.');
    }

    // 2. Cooldown Check (10 minutes = 600s)
    const cooldownKey = `confession:cooldown:${guild.id}:${authorId}`;
    const remainingTtl = await redis.ttl(cooldownKey);

    if (remainingTtl > 0) {
      const remainingMinutes = Math.ceil(remainingTtl / 60);
      throw new Error(`Veuillez patienter encore **${remainingMinutes} minute(s)** avant d'envoyer une nouvelle confession.`);
    }

    // 3. Compute sequential number #N
    const count = await prisma.confession.count({
      where: { guildId: guild.id },
    });
    const confessionNumber = count + 1;

    // 4. Send anonymous embed to confession channel
    const embed = EmbedService.create(
      `🤫 Confession #${confessionNumber}`,
      `"${content}"`,
      config.bot.colors.primary
    ).setFooter({ text: `${config.bot.signature} • Confession Anonyme #${confessionNumber}` });

    const sentMessage = await (channel as TextChannel).send({ embeds: [embed] });

    // 5. Store record in DB (authorId kept private for staff modlog)
    await prisma.confession.create({
      data: {
        guildId: guild.id,
        number: confessionNumber,
        authorId,
        content,
        messageId: sentMessage.id,
      },
    });

    // 6. Set 10 minute cooldown in Redis
    await redis.set(cooldownKey, '1', 'EX', 600);

    return { number: confessionNumber, messageId: sentMessage.id };
  }

  /**
   * Staff Modlog: Reveals the true author of a confession and logs the action
   */
  static async revealAuthor(
    guild: Guild,
    staffUserId: string,
    numberOrMessageId: string
  ) {
    let confession = null;

    // Try finding by number if numeric input
    if (/^\d+$/.test(numberOrMessageId)) {
      const num = parseInt(numberOrMessageId, 10);
      confession = await prisma.confession.findUnique({
        where: { guildId_number: { guildId: guild.id, number: num } },
      });
    }

    // Fallback: try finding by messageId
    if (!confession) {
      confession = await prisma.confession.findFirst({
        where: { guildId: guild.id, messageId: numberOrMessageId },
      });
    }

    if (!confession) {
      throw new Error(`Aucune confession trouvée pour \`${numberOrMessageId}\`.`);
    }

    // Fetch staff member log channel if available
    const guildConfig = await prisma.guild.findUnique({ where: { id: guild.id } });
    if (guildConfig?.logChannelId) {
      const logChan = guild.channels.cache.get(guildConfig.logChannelId);
      if (logChan && logChan.isTextBased() && 'send' in logChan) {
        const logEmbed = EmbedService.warning(
          '🔍 Modlog — Révélation d\'Auteur de Confession',
          `Un membre du staff a consulté les détails d'une confession anonyme.`
        ).addFields(
          { name: '👮 Modérateur', value: `<@${staffUserId}>`, inline: true },
          { name: '🤫 Confession', value: `**#${confession.number}**`, inline: true },
          { name: '👤 Auteur identifié', value: `<@${confession.authorId}> (\`${confession.authorId}\`)`, inline: true },
          { name: '💬 Contenu', value: `*"${confession.content}"*`, inline: false }
        );

        await (logChan as TextChannel).send({ embeds: [logEmbed] }).catch(() => null);
      }
    }

    return confession;
  }
}
