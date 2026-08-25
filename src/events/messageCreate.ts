import { Message, PermissionFlagsBits, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from '../services/redisService.js';
import { EmbedService } from '../services/embedService.js';
import { logger } from '../utils/logger.js';

import { TicketService } from '../services/ticketService.js';
import { wordChainSessions } from '../commands/games/wordchain.js';

import { BlacklistService } from '../services/blacklistService.js';
import { handleOwnerCommand } from '../owner-commands/ownerHandler.js';
import { LevelingService } from '../services/levelingService.js';

export async function handleMessageCreate(message: Message) {
  if (message.author.bot) return;

  // 0. Owner Commands Handler (checks owner ID & prefix, silently ignores if not owner)
  const isOwnerCommand = await handleOwnerCommand(message);
  if (isOwnerCommand) return;

  // Centralized Blacklist Guard: Silently ignore blacklisted users or guilds
  const blacklist = await BlacklistService.isBlacklisted(message.author.id, message.guild?.id);
  if (blacklist.blacklisted) return;
  if (!message.guild || !message.channel.isTextBased() || !('send' in message.channel)) return;

  // Record first staff response in ticket channels
  TicketService.recordFirstResponse(message.channel.id, message.author.id).catch(() => null);

  // Passive Leveling XP Handler
  if (message.member) {
    LevelingService.handleMessageXP(message.guild.id, message.member, message.channel.id).catch(() => null);
  }

  // WordChain Live Validation Handler
  const session = wordChainSessions.get(message.channel.id);
  if (session) {
    const rawWord = message.content.trim();
    // Ignore commands or multi-word messages
    if (!rawWord.startsWith('/') && !rawWord.startsWith('!') && !rawWord.includes(' ')) {
      const cleanWord = rawWord.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const firstChar = cleanWord.charAt(0);

      if (firstChar === session.lastChar) {
        const lowerWord = cleanWord.toLowerCase();
        if (!session.usedWords.has(lowerWord)) {
          // Valid word!
          session.usedWords.add(lowerWord);
          session.lastWord = cleanWord;
          session.lastChar = cleanWord.slice(-1);
          session.scoreCount++;

          const currentPts = session.playerScores.get(message.author.id) || 0;
          session.playerScores.set(message.author.id, currentPts + 1);

          await message.react('✅').catch(() => null);

          // Reset turn timer
          if (session.timer) clearTimeout(session.timer);
          session.timer = setTimeout(async () => {
            const active = wordChainSessions.get(message.channel.id);
            if (!active) return;

            wordChainSessions.delete(message.channel.id);

            const leaderboardLines = Array.from(active.playerScores.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([userId, pts], idx) => `${idx + 1}. <@${userId}> — **${pts} mot(s)**`);

            const embed = EmbedService.create(
              '🔤 Chaîne de Mots — Partie Terminée !',
              `⏰ **Temps écoulé !** Aucun mot valide n'a été proposé dans le délai de \`${active.timeoutSec}s\`.\n\n` +
                `📊 **Longueur de la chaîne** : **${active.scoreCount} mot(s)**\n` +
                `🔤 **Dernier mot valide** : \`${active.lastWord}\`\n\n` +
                `🏆 **Classement des joueurs** :\n${leaderboardLines.length > 0 ? leaderboardLines.join('\n') : '`Aucun point marqué`'}`,
              0x0B3D2E
            );

            const targetChan = message.channel as TextChannel;
            await targetChan.send({ embeds: [embed] }).catch(() => null);
          }, session.timeoutSec * 1000);

          return;
        } else {
          await message.react('⚠️').catch(() => null); // Already used
        }
      } else {
        await message.react('❌').catch(() => null); // Wrong starting letter
      }
    }
  }

  // 0. Bot Ping Mention Handler
  const botUser = message.client.user;
  if (botUser && (message.content.trim() === `<@${botUser.id}>` || message.content.trim() === `<@!${botUser.id}>`)) {
    const embed = EmbedService.create(
      '🌲 Centre d Assistance Flowie by Florynx Labs',
      'Voici les **35 commandes** réparties en 6 modules. Utilisez `/help` pour voir toutes les options.'
    )
      .addFields(
        {
          name: '⚙️ Core (4)',
          value: '`/ping` • `/help` • `/info` • `/botstats`',
          inline: false,
        },
        {
          name: '🛡️ Modération (10)',
          value: '`/warn` • `/warnings` • `/ban` • `/unban` • `/kick` • `/mute` • `/unmute` • `/clear` • `/lock` • `/unlock`',
          inline: false,
        },
        {
          name: '📊 Gestion (6)',
          value: '`/config` • `/welcome` • `/autorole` • `/reactionrole` • `/announce` • `/stats`',
          inline: false,
        },
        {
          name: '💰 Économie (8)',
          value: '`/balance` • `/daily` • `/work` • `/pay` • `/leaderboard` • `/bank` • `/shop` • `/inventory`',
          inline: false,
        },
        {
          name: '🎲 Jeux & Casino (6)',
          value: '`/coinflip` • `/dice` • `/slots` • `/rps` • `/blackjack` • `/trivia`',
          inline: false,
        },
        {
          name: '🎉 Giveaways (1)',
          value: '`/giveaway` *(sous-commandes: start, list, end, reroll)*',
          inline: false,
        }
      )
      .setFooter({ text: 'Flowie • Florynx Labs | 35 commandes enregistrées' });

    await message.reply({ embeds: [embed] });
    return;
  }

  try {
    const guildConfig = await prisma.guild.findUnique({
      where: { id: message.guild.id },
    });

    if (!guildConfig || !guildConfig.antiSpamEnabled) return;

    // Skip administrators and moderators
    if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return;
    }

    // 1. Anti-Link detection
    const linkRegex = /(https?:\/\/[^\s]+)/gi;
    if (linkRegex.test(message.content)) {
      await message.delete().catch(() => null);
      const warnMsg = await message.channel.send({
        embeds: [
          EmbedService.warning(
            'Anti-Lien actif',
            `${message.author}, les liens externes ne sont pas autorisés dans ce salon.`
          ),
        ],
      });
      setTimeout(() => warnMsg.delete().catch(() => null), 5000);
      return;
    }

    // 2. Anti-Spam rate limiting (5 messages in 3 seconds)
    const redisKey = `antispam:${message.guild.id}:${message.author.id}`;
    const rawCount = await redis.get(redisKey);
    const count = rawCount ? parseInt(rawCount, 10) : 0;

    if (count >= 5) {
      await message.delete().catch(() => null);
      const warnMsg = await message.channel.send({
        embeds: [
          EmbedService.warning(
            'Anti-Spam actif',
            `${message.author}, veuillez ralentir l envoi de messages.`
          ),
        ],
      });
      setTimeout(() => warnMsg.delete().catch(() => null), 5000);
    } else {
      await redis.set(redisKey, (count + 1).toString(), 'EX', 3);
    }
  } catch (err) {
    logger.error({ err }, 'Error in anti-spam message listener');
  }
}
