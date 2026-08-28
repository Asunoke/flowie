import { Client, TextChannel, Guild } from 'discord.js';
import cron from 'node-cron';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { EmbedService } from './embedService.js';
import { GuildConfigService } from './guildConfigService.js';

export interface ParsedTrigger {
  type: 'date' | 'member_count';
  date?: Date;
  memberCount?: number;
}

export interface CreateCapsuleParams {
  guildId: string;
  authorId: string;
  authorTag: string;
  content: string;
  triggerInput: string;
  isPublic?: boolean;
  currentMemberCount: number;
}

export class TimeCapsuleService {
  /**
   * Default configuration constraints
   */
  public static MAX_ACTIVE_CAPSULES = 3;
  public static MAX_CONTENT_LENGTH = 2000;
  public static MIN_DATE_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours minimum

  /**
   * Parse trigger input string into date or member_count trigger.
   * Supports:
   * - Relative durations: "6 mois", "1 an", "24h", "48h", "7 jours", "30d", "1m", "1y", etc.
   * - Absolute date strings: "2027-01-01", "2027-01-01 12:00", etc.
   * - Member threshold: "1000 membres", "5000 members", "1000"
   */
  public static parseTrigger(triggerInput: string, currentMemberCount: number): ParsedTrigger {
    const trimmed = triggerInput.trim();

    // 1. Check member count threshold format (e.g., "1000 membres", "5000 members")
    const memberMatch = trimmed.match(/^(\d+)\s*(?:membres?|members?)$/i);
    if (memberMatch) {
      const count = parseInt(memberMatch[1], 10);
      if (isNaN(count) || count <= currentMemberCount) {
        throw new Error(`Le palier de membres (${count}) doit être supérieur au nombre actuel de membres du serveur (${currentMemberCount}).`);
      }
      return { type: 'member_count', memberCount: count };
    }

    // 2. Check relative duration format (e.g. "24h", "2 jours", "6 mois", "1 an", "30d", "1y")
    const relMatch = trimmed.match(/^(\d+)\s*(h|heures?|hours?|d|j|jours?|days?|m|mois|months?|y|a|ans?|years?)$/i);
    if (relMatch) {
      const amount = parseInt(relMatch[1], 10);
      const unit = relMatch[2].toLowerCase();
      const now = new Date();

      if (['h', 'heure', 'heures', 'hour', 'hours'].includes(unit)) {
        now.setHours(now.getHours() + amount);
      } else if (['d', 'j', 'jour', 'jours', 'day', 'days'].includes(unit)) {
        now.setDate(now.getDate() + amount);
      } else if (['m', 'mois', 'month', 'months'].includes(unit)) {
        now.setMonth(now.getMonth() + amount);
      } else if (['y', 'a', 'an', 'ans', 'year', 'years'].includes(unit)) {
        now.setFullYear(now.getFullYear() + amount);
      }

      if (now.getTime() < Date.now() + this.MIN_DATE_DELAY_MS - 60000) {
        throw new Error('Une capsule à déclenchement par date ne peut pas être fixée à moins de 24h dans le futur.');
      }
      return { type: 'date', date: now };
    }

    // 3. Check ISO / standard date string format (e.g., "2027-01-01")
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      if (parsedDate.getTime() < Date.now() + this.MIN_DATE_DELAY_MS - 60000) {
        throw new Error('Une capsule à déclenchement par date ne peut pas être fixée à moins de 24h dans le futur.');
      }
      return { type: 'date', date: parsedDate };
    }

    // 4. Fallback check: if raw number provided like "1000", treat as member threshold if > currentMemberCount
    const rawNumber = parseInt(trimmed, 10);
    if (!isNaN(rawNumber) && /^\d+$/.test(trimmed)) {
      if (rawNumber > currentMemberCount) {
        return { type: 'member_count', memberCount: rawNumber };
      } else {
        throw new Error(`Le palier de membres (${rawNumber}) doit être supérieur au nombre actuel de membres (${currentMemberCount}).`);
      }
    }

    throw new Error('Format de déclencheur invalide. Utilisez une date future (ex: `2027-01-01`), une durée (ex: `6 mois`, `24h`), ou un palier (ex: `1000 membres`).');
  }

  /**
   * Creates a sealed time capsule after validating constraints.
   */
  public static async createCapsule(params: CreateCapsuleParams) {
    const { guildId, authorId, authorTag, content, triggerInput, isPublic = true, currentMemberCount } = params;

    // Validate content length
    if (!content || content.trim().length === 0) {
      throw new Error('Le contenu de la capsule ne peut pas être vide.');
    }
    if (content.length > this.MAX_CONTENT_LENGTH) {
      throw new Error(`Le contenu de la capsule ne peut pas dépasser ${this.MAX_CONTENT_LENGTH} caractères.`);
    }

    // Validate max active capsules count per user in guild
    const activeCount = await prisma.timeCapsule.count({
      where: {
        guildId,
        authorId,
        opened: false,
      },
    });

    if (activeCount >= this.MAX_ACTIVE_CAPSULES) {
      throw new Error(`Vous avez déjà atteint la limite de ${this.MAX_ACTIVE_CAPSULES} capsules actives simultanées sur ce serveur.`);
    }

    // Parse trigger
    const parsed = this.parseTrigger(triggerInput, currentMemberCount);

    // Create in DB
    const capsule = await prisma.timeCapsule.create({
      data: {
        guildId,
        authorId,
        authorTag,
        content: content.trim(),
        isPublic,
        triggerType: parsed.type,
        triggerDate: parsed.date ?? null,
        triggerMemberCount: parsed.memberCount ?? null,
        opened: false,
      },
    });

    logger.info({ capsuleId: capsule.id, guildId, authorId }, '[TIME_CAPSULE] Created new time capsule');
    return capsule;
  }

  /**
   * Lists all pending public capsules on a guild (hides secret ones & message content).
   */
  public static async listPublicCapsules(guildId: string) {
    const capsules = await prisma.timeCapsule.findMany({
      where: {
        guildId,
        opened: false,
        isPublic: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return capsules;
  }

  /**
   * Lists all capsules created by a specific user on a guild (includes public & secret, with status).
   */
  public static async listUserCapsules(guildId: string, authorId: string) {
    const capsules = await prisma.timeCapsule.findMany({
      where: {
        guildId,
        authorId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return capsules;
  }

  /**
   * Opens a capsule and posts the announcement in the configured channel.
   */
  public static async openCapsule(client: Client, capsuleId: string) {
    const capsule = await prisma.timeCapsule.findUnique({
      where: { id: capsuleId },
    });

    if (!capsule || capsule.opened) return;

    // Mark as opened in DB
    const updated = await prisma.timeCapsule.update({
      where: { id: capsule.id },
      data: {
        opened: true,
        openedAt: new Date(),
      },
    });

    try {
      const guild = client.guilds.cache.get(capsule.guildId) || (await client.guilds.fetch(capsule.guildId).catch(() => null));
      if (!guild) {
        logger.warn({ capsuleId: capsule.id, guildId: capsule.guildId }, '[TIME_CAPSULE] Guild not found when opening capsule');
        return updated;
      }

      const guildConfig = await GuildConfigService.getGuildConfig(guild.id);
      const targetChannelId = guildConfig.timeCapsuleChannelId || guildConfig.logChannelId;

      let targetChannel: TextChannel | null = null;
      if (targetChannelId) {
        const ch = guild.channels.cache.get(targetChannelId) || (await guild.channels.fetch(targetChannelId).catch(() => null));
        if (ch && ch instanceof TextChannel) {
          targetChannel = ch;
        }
      }

      if (!targetChannel) {
        const sysChannel = guild.systemChannel;
        if (sysChannel && sysChannel instanceof TextChannel) {
          targetChannel = sysChannel;
        }
      }

      if (!targetChannel) {
        logger.warn({ capsuleId: capsule.id, guildId: guild.id }, '[TIME_CAPSULE] No channel configured or available to post opened capsule');
        return updated;
      }

      // Check author presence
      const member = guild.members.cache.get(capsule.authorId) || (await guild.members.fetch(capsule.authorId).catch(() => null));
      const authorText = member ? `<@${capsule.authorId}>` : `**${capsule.authorTag}** *(membre parti du serveur)*`;

      // Build announcement description
      const createdStr = `<t:${Math.floor(capsule.createdAt.getTime() / 1000)}:f>`;
      let triggerContextStr = '';
      if (capsule.triggerType === 'date' && capsule.triggerDate) {
        triggerContextStr = `Cette capsule a été scellée le ${createdStr} et s'ouvre aujourd'hui car la date prévue a été atteinte.`;
      } else if (capsule.triggerType === 'member_count' && capsule.triggerMemberCount) {
        triggerContextStr = `Cette capsule a été scellée le ${createdStr} et s'ouvre aujourd'hui car le serveur a atteint **${capsule.triggerMemberCount} membres** !`;
      } else {
        triggerContextStr = `Cette capsule a été scellée le ${createdStr} et s'ouvre aujourd'hui.`;
      }

      const embed = EmbedService.gold('⏳ Capsule Temporelle Ouverte !', triggerContextStr)
        .addFields(
          { name: '👤 Auteur original', value: authorText, inline: true },
          { name: '📅 Scellée le', value: createdStr, inline: true },
          { name: '📜 Message de la capsule', value: capsule.content, inline: false }
        )
        .setFooter({ text: `${config.bot.signature} • Capsule Temporelle` });

      await targetChannel.send({ content: member ? `<@${capsule.authorId}>` : undefined, embeds: [embed] });
      logger.info({ capsuleId: capsule.id, guildId: guild.id }, '[TIME_CAPSULE] Successfully opened and posted capsule');
    } catch (err) {
      logger.error({ err, capsuleId: capsule.id }, '[TIME_CAPSULE] Error posting opened capsule to Discord');
    }

    return updated;
  }

  /**
   * Checks pending capsules (date & member count) across all guilds.
   */
  public static async checkPendingCapsules(client: Client) {
    try {
      const now = new Date();

      // 1. Pending date capsules
      const pendingDateCapsules = await prisma.timeCapsule.findMany({
        where: {
          opened: false,
          triggerType: 'date',
          triggerDate: { lte: now },
        },
      });

      for (const capsule of pendingDateCapsules) {
        await this.openCapsule(client, capsule.id);
      }

      // 2. Pending member count capsules
      const pendingMemberCapsules = await prisma.timeCapsule.findMany({
        where: {
          opened: false,
          triggerType: 'member_count',
        },
      });

      for (const capsule of pendingMemberCapsules) {
        if (!capsule.triggerMemberCount) continue;
        const guild = client.guilds.cache.get(capsule.guildId) || (await client.guilds.fetch(capsule.guildId).catch(() => null));
        if (guild && guild.memberCount >= capsule.triggerMemberCount) {
          await this.openCapsule(client, capsule.id);
        }
      }
    } catch (err) {
      logger.error({ err }, '[TIME_CAPSULE] Error checking pending capsules');
    }
  }

  /**
   * Event-driven check for member count capsules when a new member joins a guild.
   */
  public static async checkMemberCountCapsules(guild: Guild) {
    try {
      const pendingMemberCapsules = await prisma.timeCapsule.findMany({
        where: {
          guildId: guild.id,
          opened: false,
          triggerType: 'member_count',
          triggerMemberCount: { lte: guild.memberCount },
        },
      });

      for (const capsule of pendingMemberCapsules) {
        await this.openCapsule(guild.client, capsule.id);
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id }, '[TIME_CAPSULE] Error checking member count capsules on member join');
    }
  }

  /**
   * Emergency force-open reserved for bot owner.
   */
  public static async forceOpenCapsule(capsuleId: string, ownerId: string) {
    const capsule = await prisma.timeCapsule.findUnique({
      where: { id: capsuleId },
    });

    if (!capsule) {
      throw new Error(`Capsule \`${capsuleId}\` introuvable.`);
    }

    const updated = await prisma.timeCapsule.update({
      where: { id: capsuleId },
      data: {
        opened: true,
        openedAt: new Date(),
      },
    });

    logger.warn(
      { capsuleId, ownerId, guildId: capsule.guildId, authorId: capsule.authorId },
      '[OWNER_FORCE_OPEN] Emergency force-open of time capsule executed by bot owner'
    );

    return updated;
  }

  /**
   * Starts periodic scheduler (every hour) + initial check on startup.
   */
  public static startScheduler(client: Client) {
    logger.info('[TIME_CAPSULE] Starting TimeCapsule scheduler (every hour)...');

    // Run initial catch-up check immediately on boot
    this.checkPendingCapsules(client).catch((err) => {
      logger.error({ err }, '[TIME_CAPSULE] Error during initial catch-up check');
    });

    // Schedule cron job to run at minute 0 of every hour
    cron.schedule('0 * * * *', () => {
      this.checkPendingCapsules(client).catch((err) => {
        logger.error({ err }, '[TIME_CAPSULE] Error in periodic cron check');
      });
    });
  }
}
