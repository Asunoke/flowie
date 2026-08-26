import cron, { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface BirthdayEntry {
  userId: string;
  day: number;
  month: number;
  year?: number | null;
  daysUntil: number;
}

const MONTH_NAMES = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export class BirthdayService {
  private static cronTask: ScheduledTask | null = null;

  /**
   * Validates if a day and month represent a valid calendar date
   */
  static isValidDate(day: number, month: number, year?: number): boolean {
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const testYear = year || 2024; // 2024 is a leap year to allow Feb 29
    const d = new Date(testYear, month - 1, day);
    return d.getMonth() === month - 1 && d.getDate() === day;
  }

  /**
   * Registers or updates a user's birthday for a guild
   */
  static async setBirthday(guildId: string, userId: string, day: number, month: number, year?: number) {
    if (!this.isValidDate(day, month, year)) {
      throw new Error(`La date ${day}/${month}${year ? `/${year}` : ''} n'est pas une date valide.`);
    }

    return prisma.birthday.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, day, month, year: year || null },
      update: { day, month, year: year || null },
    });
  }

  /**
   * Removes a user's registered birthday
   */
  static async removeBirthday(guildId: string, userId: string): Promise<boolean> {
    const res = await prisma.birthday.deleteMany({
      where: { guildId, userId },
    });
    return res.count > 0;
  }

  /**
   * Fetches sorted list of upcoming birthdays for a guild
   */
  static async getNextBirthdays(
    guildId: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<{ entries: BirthdayEntry[]; totalPages: number }> {
    const allBirthdays = await prisma.birthday.findMany({
      where: { guildId },
    });

    if (allBirthdays.length === 0) {
      return { entries: [], totalPages: 1 };
    }

    const today = new Date();
    const currentYear = today.getFullYear();

    const formatted: BirthdayEntry[] = allBirthdays.map(
      (b: { userId: string; day: number; month: number; year: number | null }) => {
        let bDate = new Date(currentYear, b.month - 1, b.day);

      // Reset time to midnight for accurate day comparison
      bDate.setHours(0, 0, 0, 0);

      const tDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      if (bDate.getTime() < tDate.getTime()) {
        // Birthday has already passed this year, compute for next year
        bDate = new Date(currentYear + 1, b.month - 1, b.day);
      }

      const diffTime = bDate.getTime() - tDate.getTime();
      const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        userId: b.userId,
        day: b.day,
        month: b.month,
        year: b.year,
        daysUntil,
      };
    });

    formatted.sort((a, b) => a.daysUntil - b.daysUntil);

    const totalPages = Math.ceil(formatted.length / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const entries = formatted.slice(startIndex, startIndex + pageSize);

    return { entries, totalPages };
  }

  /**
   * Updates birthday configuration for a guild
   */
  static async setConfig(guildId: string, channelId?: string, roleId?: string, enabled: boolean = true) {
    return prisma.birthdayConfig.upsert({
      where: { guildId },
      create: { guildId, channelId: channelId || null, roleId: roleId || null, enabled },
      update: {
        channelId: channelId !== undefined ? channelId : undefined,
        roleId: roleId !== undefined ? roleId : undefined,
        enabled,
      },
    });
  }

  /**
   * Retrieves birthday configuration for a guild
   */
  static async getConfig(guildId: string) {
    return prisma.birthdayConfig.findUnique({
      where: { guildId },
    });
  }

  /**
   * Starts daily cron job (runs every day at midnight 00:00)
   */
  static startScheduler(client: Client) {
    if (this.cronTask) return;

    logger.info('[BIRTHDAY] Starting Birthday Daily Cron Job (at midnight 00:00)...');

    // Run check on startup after 15 seconds
    setTimeout(() => {
      this.checkAndAnnounceBirthdays(client).catch((err) =>
        logger.error({ err }, '[BIRTHDAY] Error in initial birthday check')
      );
    }, 15000);

    // Schedule daily at 00:00
    this.cronTask = cron.schedule('0 0 * * *', async () => {
      logger.info('[BIRTHDAY] Running daily midnight birthday check...');
      await this.checkAndAnnounceBirthdays(client).catch((err) =>
        logger.error({ err }, '[BIRTHDAY] Error in daily birthday check cycle')
      );
    });
  }

  /**
   * Checks today's birthdays across all configured guilds, posts announcements, and manages temporary roles
   */
  static async checkAndAnnounceBirthdays(client: Client) {
    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const configs = await prisma.birthdayConfig.findMany({
      where: { enabled: true },
    });

    for (const conf of configs) {
      try {
        const guild = client.guilds.cache.get(conf.guildId);
        if (!guild) continue;

        // Fetch today's birthdays for this guild
        const todaysBirthdays = await prisma.birthday.findMany({
          where: {
            guildId: conf.guildId,
            day: todayDay,
            month: todayMonth,
          },
        });

        const todayUserIds = new Set(todaysBirthdays.map((b: { userId: string }) => b.userId));

        // ─── 1. Temporary Role Management (Resilient) ───────────────────────
        if (conf.roleId) {
          const birthdayRole = guild.roles.cache.get(conf.roleId);
          if (birthdayRole) {
            // Remove role from members whose birthday is NOT today
            for (const [, member] of birthdayRole.members) {
              if (!todayUserIds.has(member.id)) {
                await member.roles.remove(birthdayRole).catch((err) => {
                  logger.debug({ err, memberId: member.id }, '[BIRTHDAY] Failed to remove expired birthday role');
                });
              }
            }

            // Assign role to today's birthday members
            for (const b of todaysBirthdays) {
              const member = await guild.members.fetch(b.userId).catch(() => null);
              if (member && !member.roles.cache.has(birthdayRole.id)) {
                await member.roles.add(birthdayRole).catch((err) => {
                  logger.debug({ err, memberId: member.id }, '[BIRTHDAY] Failed to add birthday role');
                });
              }
            }
          }
        }

        // ─── 2. Announcement Channel Message ────────────────────────────────
        if (conf.channelId && todaysBirthdays.length > 0) {
          const channel = guild.channels.cache.get(conf.channelId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            const mentions = todaysBirthdays.map((b: { userId: string; year?: number | null }) => {
              const ageText = b.year ? ` (${currentYear - b.year} ans 🎉)` : '';
              return `<@${b.userId}>${ageText}`;
            });

            const embed = EmbedService.gold(
              '🎂 Joyeux Anniversaire ! 🎉',
              `Aujourd'hui, c'est l'anniversaire de :\n\n` +
                mentions.map((m: string) => `• ${m}`).join('\n') +
                `\n\nToute la communauté de **${guild.name}** vous souhaite une excellente journée ! 🥳🎈`
            ).setFooter({ text: `${config.bot.signature} • Anniversaires` });

            await (channel as TextChannel).send({
              content: `🎉 Joyeux anniversaire ${todaysBirthdays.map((b: { userId: string }) => `<@${b.userId}>`).join(' ')} !`,
              embeds: [embed],
            }).catch(() => null);
          }
        }

      } catch (err) {
        logger.error({ err, guildId: conf.guildId }, '[BIRTHDAY] Error processing birthdays for guild');
      }
    }
  }

  static getMonthName(month: number): string {
    return MONTH_NAMES[month - 1] || 'Inconnu';
  }
}
