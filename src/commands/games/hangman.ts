import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { prisma } from '../../database/db.js';
import { config } from '../../config/index.js';

const FALLBACK_WORDS = [
  'DEVELOPPEUR',
  'BOT',
  'DISCORD',
  'SERVEUR',
  'COMMUNAUTE',
  'FLORYNX',
  'ORDINATEUR',
  'ALGORITHME',
  'DATABASE',
  'ROULETTE',
  'VICTOIRE',
];

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('hangman')
    .setDescription('Jouer au Jeu du Pendu (Solo ou Multijoueur)')
    .addSubcommand((sub) =>
      sub.setName('solo').setDescription('Partie solo avec un mot mystère aléatoire')
    )
    .addSubcommand((sub) =>
      sub
        .setName('multi')
        .setDescription('Proposer un mot mystère à faire deviner au serveur')
        .addStringOption((opt) =>
          opt
            .setName('mot')
            .setDescription('Le mot secret à faire deviner (sans accents, 3-20 lettres)')
            .setRequired(true)
        )
    ),
  category: 'games',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    let secretWord = '';

    if (subcommand === 'solo') {
      // Try fetching word from DB
      try {
        if (prisma.hangmanWord) {
          const dbWords = await prisma.hangmanWord.findMany({ take: 20 });
          if (dbWords.length > 0) {
            secretWord = dbWords[Math.floor(Math.random() * dbWords.length)].word.toUpperCase();
          }
        }
      } catch {
        // Fallback
      }

      if (!secretWord) {
        secretWord = FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
      }
    } else if (subcommand === 'multi') {
      const input = interaction.options.getString('mot', true).trim().toUpperCase();
      const cleanWord = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '');

      if (cleanWord.length < 3 || cleanWord.length > 20) {
        await interaction.reply({
          embeds: [EmbedService.warning('Mot invalide', 'Le mot doit contenir entre 3 et 20 lettres.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      secretWord = cleanWord;
    }

    // Initialize Game state
    const guessedLetters = new Set<string>();
    let wrongCount = 0;
    const maxWrong = 6;

    const getDisplayWord = () => {
      return secretWord
        .split('')
        .map((letter) => (guessedLetters.has(letter) ? letter : '\\_'))
        .join(' ');
    };

    const isWon = () => {
      return secretWord.split('').every((letter) => guessedLetters.has(letter));
    };

    const buildEmbed = (statusText: string) => {
      const ascii = GameEngine.getHangmanASCII(wrongCount);
      const usedStr = Array.from(guessedLetters).sort().join(', ') || '`Aucune`';

      return EmbedService.gold('🪓 Le Pendu', statusText)
        .addFields(
          { name: '🔤 Mot à deviner', value: `### ${getDisplayWord()}`, inline: false },
          { name: '📊 Erreurs', value: `\`${wrongCount} / ${maxWrong}\``, inline: true },
          { name: '📝 Lettres essayées', value: usedStr, inline: true },
          { name: '🖼️ Pendu', value: ascii, inline: false }
        )
        .setFooter({ text: 'Répondez dans le tchat avec une lettre ou le mot complet !' });
    };

    const replyMessage = await interaction.reply({
      embeds: [buildEmbed(`Partie lancée par ${interaction.user} !Devinez le mot.`)],
      fetchReply: true,
    });

    const channel = interaction.channel;
    if (!channel || !('createMessageCollector' in channel)) return;

    const collector = channel.createMessageCollector({
      time: 120_000,
      filter: (m) => !m.author.bot,
    });

    collector.on('collect', async (msg) => {
      const input = msg.content.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!input || input.startsWith('/') || input.startsWith('!')) return;

      // Full word guess
      if (input.length > 1) {
        if (input === secretWord) {
          secretWord.split('').forEach((l) => guessedLetters.add(l));
          collector.stop('win');

          if (subcommand === 'solo') {
            await EconomyService.addBalance(
              interaction.guild!.id,
              msg.author.id,
              50,
              'GAME_WIN',
              'Victoire au Pendu Solo'
            );
          }

          const currency = await EconomyService.getCurrencyName(interaction.guild!.id);
          const winEmbed = EmbedService.success(
            '🎉 Pendu Gagné !',
            `**${msg.author}** a trouvé le mot exact : **${secretWord}** !\n` +
              (subcommand === 'solo' ? `💰 **+50 ${currency}** ajoutés à votre portefeuille !` : '')
          );
          await replyMessage.edit({ embeds: [winEmbed] });
        } else {
          wrongCount++;
          await msg.react('❌').catch(() => null);

          if (wrongCount >= maxWrong) {
            collector.stop('lose');
            const loseEmbed = EmbedService.error(
              '💀 Pendu Perdu !',
              `Le mot était : **${secretWord}**.\n${GameEngine.getHangmanASCII(6)}`
            );
            await replyMessage.edit({ embeds: [loseEmbed] });
          } else {
            await replyMessage.edit({ embeds: [buildEmbed(`❌ **${msg.author.username}** s'est trompé avec le mot \`${input}\` !`)] });
          }
        }
        return;
      }

      // Single letter guess
      const letter = input;
      if (!/^[A-Z]$/.test(letter)) return;

      if (guessedLetters.has(letter)) {
        await msg.react('⚠️').catch(() => null);
        return;
      }

      guessedLetters.add(letter);

      if (secretWord.includes(letter)) {
        await msg.react('✅').catch(() => null);

        if (isWon()) {
          collector.stop('win');

          if (subcommand === 'solo') {
            await EconomyService.addBalance(
              interaction.guild!.id,
              msg.author.id,
              50,
              'GAME_WIN',
              'Victoire au Pendu Solo'
            );
          }

          const currency = await EconomyService.getCurrencyName(interaction.guild!.id);
          const winEmbed = EmbedService.success(
            '🎉 Pendu Gagné !',
            `Le mot **${secretWord}** a été entièrement trouvé par ${msg.author} !\n` +
              (subcommand === 'solo' ? `💰 **+50 ${currency}** ajoutés à votre portefeuille !` : '')
          );
          await replyMessage.edit({ embeds: [winEmbed] });
        } else {
          await replyMessage.edit({ embeds: [buildEmbed(`✅ **${letter}** est dans le mot !`)] });
        }
      } else {
        wrongCount++;
        await msg.react('❌').catch(() => null);

        if (wrongCount >= maxWrong) {
          collector.stop('lose');
          const loseEmbed = EmbedService.error(
            '💀 Pendu Perdu !',
            `Le mot était : **${secretWord}**.\n${GameEngine.getHangmanASCII(6)}`
          );
          await replyMessage.edit({ embeds: [loseEmbed] });
        } else {
          await replyMessage.edit({ embeds: [buildEmbed(`❌ **${letter}** n'est pas dans le mot.`)] });
        }
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        const timeEmbed = EmbedService.warning(
          '⏰ Temps écoulé',
          `La partie de Pendu est terminée. Le mot était : **${secretWord}**.`
        );
        await replyMessage.edit({ embeds: [timeEmbed] }).catch(() => null);
      }
    });
  },
};

export default command;
