import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { TicketService } from '../../services/ticketService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-stats')
    .setDescription('Afficher les statistiques d\'utilisation des tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((opt) =>
      opt
        .setName('periode')
        .setDescription('Période d\'analyse (défaut: Tout)')
        .addChoices(
          { name: 'Dernières 24 heures', value: '24h' },
          { name: 'Derniers 7 jours', value: '7d' },
          { name: 'Derniers 30 jours', value: '30d' },
          { name: 'Tout l\'historique', value: 'all' }
        )
    ),
  category: 'tickets',
  userPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    await interaction.deferReply();

    const period = interaction.options.getString('periode') || 'all';
    const stats = await TicketService.getTicketStats(interaction.guild.id, period);

    if (!stats) {
      await interaction.editReply({
        embeds: [
          EmbedService.error(
            'Erreur',
            'Les statistiques sont temporairement indisponibles.'
          ),
        ],
      });
      return;
    }

    // Format average response time
    let avgRespStr = '`Aucune réponse`';
    if (stats.avgResponseTimeMs > 0) {
      const minutes = Math.round(stats.avgResponseTimeMs / 60000);
      if (minutes < 60) {
        avgRespStr = `\`${minutes} minute(s)\``;
      } else {
        const hours = (minutes / 60).toFixed(1);
        avgRespStr = `\`${hours} heure(s)\``;
      }
    }

    // Breakdown by type
    const typeLines = Object.entries(stats.typeCounts).map(
      ([type, count]) => `• **${type}** : \`${count}\``
    );
    const typeStr = typeLines.length > 0 ? typeLines.join('\n') : '`Aucune donnée`';

    // Staff Leaderboard
    const staffLines = stats.staffLeaderboard.map(
      (item, idx) => `${idx + 1}. <@${item.staffId}> — \`${item.count} ticket(s)\``
    );
    const staffStr = staffLines.length > 0 ? staffLines.join('\n') : '`Aucun ticket traité`';

    const periodLabel: Record<string, string> = {
      '24h': 'Dernières 24h',
      '7d': 'Derniers 7 jours',
      '30d': 'Derniers 30 jours',
      all: 'Global',
    };

    const embed = EmbedService.gold(
      `📊 Statistiques des Tickets — ${interaction.guild.name}`,
      `Période sélectionnée : **${periodLabel[period] || 'Global'}**`
    ).addFields(
      { name: '📥 Total Ouverts', value: `\`${stats.total}\``, inline: true },
      { name: '🟢 En Cours', value: `\`${stats.open}\``, inline: true },
      { name: '🔒 Fermés', value: `\`${stats.closed}\``, inline: true },
      { name: '⚡ Temps de 1ère réponse moyen', value: avgRespStr, inline: false },
      { name: '🏷️ Répartition par type', value: typeStr, inline: true },
      { name: '🏆 Classement Staff', value: staffStr, inline: true }
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
