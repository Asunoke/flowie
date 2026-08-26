import { Message, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';

export interface ProcessCountResult {
  valid: boolean;
  reason?: 'same_user' | 'wrong_number' | 'not_a_number';
  currentCount: number;
  highestRecord: number;
  isNewRecord: boolean;
}

export class CountingService {
  /**
   * Sets up or updates counting game channel for a guild
   */
  static async setup(guildId: string, channelId: string) {
    return prisma.countingGame.upsert({
      where: { guildId },
      create: {
        guildId,
        channelId,
        currentCount: 0,
        lastUserId: null,
        highestRecord: 0,
        enabled: true,
      },
      update: {
        channelId,
        enabled: true,
      },
    });
  }

  /**
   * Disables counting game for a guild
   */
  static async disable(guildId: string) {
    const existing = await prisma.countingGame.findUnique({ where: { guildId } });
    if (!existing) return false;

    await prisma.countingGame.update({
      where: { guildId },
      data: { enabled: false },
    });
    return true;
  }

  /**
   * Gets counting game record for a guild
   */
  static async getRecord(guildId: string) {
    return prisma.countingGame.findUnique({
      where: { guildId },
    });
  }

  /**
   * Checks if a channel is configured for counting game
   */
  static async getGameByChannel(channelId: string) {
    return prisma.countingGame.findFirst({
      where: { channelId, enabled: true },
    });
  }

  /**
   * Processes an incoming message in a counting game channel
   */
  static async handleMessage(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    const game = await this.getGameByChannel(message.channel.id);
    if (!game) return false;

    const content = message.content.trim();
    // Parse math expression or integer (e.g., "42" or "40+2")
    let numberVal: number | null = null;

    if (/^\d+$/.test(content)) {
      numberVal = parseInt(content, 10);
    } else {
      // Try evaluating simple safe math expression (e.g. 5+5)
      try {
        if (/^[\d\s+\-*/()]+$/.test(content)) {
          // eslint-disable-next-line no-eval
          const evaled = eval(content);
          if (typeof evaled === 'number' && Number.isInteger(evaled) && evaled > 0) {
            numberVal = evaled;
          }
        }
      } catch {
        numberVal = null;
      }
    }

    if (numberVal === null) {
      // Message is not a valid number, ignore (allow regular chat/comments if needed)
      return false;
    }

    const expectedCount = game.currentCount + 1;

    // Rule 1: A user cannot count twice in a row
    if (game.lastUserId === message.author.id) {
      await message.react('❌').catch(() => null);

      await prisma.countingGame.update({
        where: { id: game.id },
        data: { currentCount: 0, lastUserId: null },
      });

      const embed = EmbedService.error(
        '💥 Erreur de comptage !',
        `**${message.author}** a compté deux fois de suite !\n` +
          `Le compteur est réinitialisé à **0**.\n` +
          `Score interrompu : **${game.currentCount}** | Record du serveur : **${game.highestRecord}**.`
      );

      await (message.channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
      return true;
    }

    // Rule 2: The number must match expectedCount exactly
    if (numberVal !== expectedCount) {
      await message.react('❌').catch(() => null);

      await prisma.countingGame.update({
        where: { id: game.id },
        data: { currentCount: 0, lastUserId: null },
      });

      const embed = EmbedService.error(
        '💥 Erreur de comptage !',
        `**${message.author}** s'est trompé (a envoyé \`${numberVal}\` au lieu de \`${expectedCount}\`) !\n` +
          `Le compteur est réinitialisé à **0**.\n` +
          `Score interrompu : **${game.currentCount}** | Record du serveur : **${game.highestRecord}**.`
      );

      await (message.channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
      return true;
    }

    // Valid Count!
    const newCount = expectedCount;
    const isNewRecord = newCount > game.highestRecord;
    const newHighest = isNewRecord ? newCount : game.highestRecord;

    await prisma.countingGame.update({
      where: { id: game.id },
      data: {
        currentCount: newCount,
        lastUserId: message.author.id,
        highestRecord: newHighest,
      },
    });

    // React with ✅ (or 🏆 for new record milestones)
    if (isNewRecord && newCount >= 10 && newCount % 10 === 0) {
      await message.react('🏆').catch(() => null);
    } else {
      await message.react('✅').catch(() => null);
    }

    return true;
  }
}
