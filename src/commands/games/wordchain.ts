import { SlashCommandBuilder, PermissionFlagsBits, TextChannel, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export interface WordChainSession {
  channelId: string;
  lastWord: string;
  lastChar: string;
  usedWords: Set<string>;
  scoreCount: number;
  playerScores: Map<string, number>;
  timeoutSec: number;
  timer: NodeJS.Timeout | null;
}

/** Active WordChain sessions per channel */
export const wordChainSessions = new Map<string, WordChainSession>();

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('wordchain')
    .setDescription('Lancer ou arrêter le jeu multijoueur de la Chaîne de Mots')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Démarrer la chaîne de mots dans le salon')
        .addIntegerOption((opt) =>
          opt
            .setName('delai')
            .setDescription('Délai en secondes par réponse (défaut: 20s)')
            .setMinValue(5)
            .setMaxValue(60)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Arrêter la chaîne de mots en cours')
    ),
  category: 'games',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;

    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;

    if (subcommand === 'start') {
      if (wordChainSessions.has(channelId)) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Partie déjà active',
              'Une session de Chaîne de Mots est déjà en cours dans ce salon.'
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const timeoutSec = interaction.options.getInteger('delai') || 20;
      const initialWords = ['FLOWIE', 'FLORYNX', 'DISCORD', 'ROBOT', 'SYSTEME', 'GALAXIE', 'TICKET'];
      const startWord = initialWords[Math.floor(Math.random() * initialWords.length)];
      const lastChar = startWord.slice(-1).toUpperCase();

      const session: WordChainSession = {
        channelId,
        lastWord: startWord,
        lastChar,
        usedWords: new Set([startWord.toLowerCase()]),
        scoreCount: 0,
        playerScores: new Map(),
        timeoutSec,
        timer: null,
      };

      // Function to handle timeout
      const handleTimeout = async () => {
        const active = wordChainSessions.get(channelId);
        if (!active) return;

        wordChainSessions.delete(channelId);

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
          config.bot.colors.primary
        );

        const targetChan = interaction.channel as TextChannel;
        await targetChan.send({ embeds: [embed] }).catch(() => null);
      };

      session.timer = setTimeout(handleTimeout, timeoutSec * 1000);
      wordChainSessions.set(channelId, session);

      const embed = EmbedService.gold(
        '🔤 Chaîne de Mots Démarrée !',
        `Chaque joueur doit proposer un mot commençant par la **dernière lettre** du mot précédent !\n\n` +
          `📌 **Mot de départ** : \`${startWord}\`\n` +
          `👉 **Prochaine lettre requise** : **${lastChar}**\n` +
          `⏱️ **Délai par mot** : \`${timeoutSec} secondes\``
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'stop') {
      const session = wordChainSessions.get(channelId);
      if (!session) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Aucune partie',
              'Aucune session de Chaîne de Mots n\'est active dans ce salon.'
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (session.timer) clearTimeout(session.timer);
      wordChainSessions.delete(channelId);

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Partie Arrêtée',
            `La session de Chaîne de Mots a été interrompue par ${interaction.user}.`
          ),
        ],
      });
      return;
    }
  },
};

export default command;
