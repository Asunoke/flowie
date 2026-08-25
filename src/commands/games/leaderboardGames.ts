import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-games')
    .setDescription('Classement des meilleurs joueurs et des plus grands gains aux jeux'),
  category: 'games',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    await interaction.deferReply();

    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    // Fetch transactions related to games
    const transactions = await prisma.transaction.findMany({
      where: {
        guildId: interaction.guild.id,
        type: { in: ['GAME_WIN', 'GAME_LOSS', 'DUEL_WIN', 'DUEL_LOSS'] },
      },
    });

    if (transactions.length === 0) {
      await interaction.editReply({
        embeds: [
          EmbedService.create(
            'ℹ️ Aucun historique de jeu',
            'Aucune partie de jeu n\'a encore été enregistrée sur ce serveur.',
            config.bot.colors.info
          ),
        ],
      });
      return;
    }

    // Aggregate Net Gains per User
    const userStats = new Map<string, { netProfit: number; wins: number; totalGames: number }>();

    transactions.forEach((tx: any) => {
      const current = userStats.get(tx.userId) || { netProfit: 0, wins: 0, totalGames: 0 };
      current.netProfit += tx.amount;
      current.totalGames += 1;
      if (tx.amount > 0) {
        current.wins += 1;
      }
      userStats.set(tx.userId, current);
    });

    // Sort by net profit DESC
    const sorted = Array.from(userStats.entries())
      .sort((a, b) => b[1].netProfit - a[1].netProfit)
      .slice(0, 10);

    const lines = sorted.map(([userId, stats], index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
      const sign = stats.netProfit >= 0 ? '+' : '';
      return `${medal} <@${userId}> — **${sign}${stats.netProfit} ${currency}** \`(${stats.wins}/${stats.totalGames} victoires)\``;
    });

    const embed = EmbedService.gold(
      `🎲 Classement Jeux & Casino — ${interaction.guild.name}`,
      `Top 10 des membres par gains nets cumulés aux jeux :\n\n${lines.join('\n')}`
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
