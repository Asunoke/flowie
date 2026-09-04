import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { InviteService } from '../../services/inviteService.js';

const invitesLeaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites-leaderboard')
    .setDescription('Afficher le classement des meilleurs inviteurs du serveur')
    .addIntegerOption((opt) =>
      opt.setName('page').setDescription('Numéro de la page').setMinValue(1).setRequired(false)
    ),
  category: 'invites',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const page = interaction.options.getInteger('page') || 1;
    const pageSize = 10;
    const { entries, totalPages } = await InviteService.getLeaderboard(
      interaction.guild.id,
      page,
      pageSize
    );

    if (entries.length === 0) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Classement vide',
            'Aucune invitation enregistrée pour le moment sur ce serveur.'
          ),
        ],
      });
      return;
    }

    const descriptionLines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rank = (page - 1) * pageSize + i + 1;
      const medal =
        rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `\`#${rank}\``;
      const userTag = `<@${entry.userId}>`;

      descriptionLines.push(
        `${medal} ${userTag} — **${entry.totalValid}** valid (✅ ${entry.realInvites} | ❌ ${entry.fakeInvites} | 🎁 ${entry.bonus >= 0 ? '+' : ''}${entry.bonus})`
      );
    }

    const embed = EmbedService.create(
      `🏆 Classement des Inviteurs — ${interaction.guild.name}`,
      descriptionLines.join('\n')
    ).setFooter({ text: `Page ${page}/${totalPages} • William Invite Tracking` });

    await interaction.reply({ embeds: [embed] });
  },
};

export default invitesLeaderboardCommand;
