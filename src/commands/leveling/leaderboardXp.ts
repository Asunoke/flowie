import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-xp')
    .setDescription('Classement des membres les plus actifs et hauts niveaux du serveur'),
  category: 'leveling',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    await interaction.deferReply();

    const topMembers = await prisma.memberXP.findMany({
      where: { guildId: interaction.guild.id },
      orderBy: { xp: 'desc' },
      take: 10,
    });

    if (topMembers.length === 0) {
      await interaction.editReply({
        embeds: [
          EmbedService.create(
            'ℹ️ Aucun membre classé',
            'Aucun membre n\'a encore accumulé d\'expérience sur ce serveur.',
            config.bot.colors.info
          ),
        ],
      });
      return;
    }

    const lines = topMembers.map((m: any, index: number) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
      return `${medal} <@${m.userId}> — **Niveau ${m.level}** (\`${m.xp} XP\`)`;
    });

    const embed = EmbedService.gold(
      `🏆 Classement XP & Niveaux — ${interaction.guild.name}`,
      `Top 10 des membres les plus actifs du serveur :\n\n${lines.join('\n')}`
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
