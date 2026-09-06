import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { PulseService } from '../../services/pulseService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pulse')
    .setDescription('Affiche l\'activité du serveur comme un pouls vivant en temps réel')
    .addSubcommand((sub) =>
      sub
        .setName('now')
        .setDescription('Affiche le pouls actuel du serveur (activité en direct)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Graphique textuel de l\'activité sur une période')
        .addStringOption((opt) =>
          opt
            .setName('période')
            .setDescription('Période d\'historique à afficher')
            .setRequired(false)
            .addChoices(
              { name: '📊 24 dernières heures', value: '24h' },
              { name: '📅 7 derniers jours', value: '7d' }
            )
        )
    ),
  category: 'pulse',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    await interaction.deferReply();

    const sub = interaction.options.getSubcommand(false) ?? 'now';

    // ── /pulse now ───────────────────────────────────────────────
    if (sub === 'now') {
      const pulse = await PulseService.getGuildPulse(interaction.guild.id);

      const topChannelStr = pulse.topChannelId
        ? `<#${pulse.topChannelId}>`
        : '`Aucun salon actif`';

      const baselineLine = pulse.baselineDelta !== null
        ? `\`${pulse.baselineLabel}\``
        : `*(${pulse.baselineLabel})*`;

      const embed = EmbedService.create(
        `${pulse.rhythm} Pulse — ${interaction.guild.name}`,
        `**${pulse.rhythmLabel}**\n\nVoici l'état d'activité du serveur en ce moment, analysé en temps réel par rapport à l'historique.`,
        config.bot.colors.primary
      )
        .addFields(
          {
            name: '⚡ Messages / Minute',
            value: `\`${pulse.msgsPerMin} msg/min\` *(moyenne glissante 10 min)*`,
            inline: true,
          },
          {
            name: '👥 Membres Actifs',
            value: `\`${pulse.activeMembers} membre(s)\` *(15 dernières minutes)*`,
            inline: true,
          },
          {
            name: '🏆 Salon le Plus Actif',
            value: topChannelStr,
            inline: true,
          },
          {
            name: '📊 Vs Habituellement à cette Heure',
            value: baselineLine,
            inline: false,
          }
        )
        .setFooter({
          text: `${config.bot.footer.text} • Utilisez /pulse history pour voir l'historique`,
          iconURL: config.bot.footer.iconUrl,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /pulse history ───────────────────────────────────────────
    if (sub === 'history') {
      const periodRaw = interaction.options.getString('période') ?? '24h';
      const period = (periodRaw === '7d' ? '7d' : '24h') as '24h' | '7d';
      const periodLabel = period === '24h' ? '24 dernières heures' : '7 derniers jours';

      const history = await PulseService.getGuildHistory(interaction.guild.id, period);

      if (history.buckets === 0) {
        await interaction.editReply({
          embeds: [
            EmbedService.error(
              '📊 Aucun Historique Disponible',
              `Aucune donnée d'activité agrégée n'est encore disponible pour les **${periodLabel}**.\n\n` +
              `L'historique se construit automatiquement toutes les heures. Revenez un peu plus tard !`
            ),
          ],
        });
        return;
      }

      const embed = EmbedService.create(
        `📊 Historique d'Activité — ${interaction.guild.name}`,
        `Activité sur les **${periodLabel}** • ${history.buckets} heure(s) enregistrée(s)\n\n` +
        `**${history.labels}**`,
        config.bot.colors.primary
      )
        .addFields(
          {
            name: '📈 Graphique (msgs/heure)',
            value: `\`\`\`\n${history.sparkline}\n\`\`\``,
            inline: false,
          },
          {
            name: '🔻 Minimum',
            value: `\`${history.min} msgs\``,
            inline: true,
          },
          {
            name: '📊 Moyenne',
            value: `\`${history.avg} msgs/h\``,
            inline: true,
          },
          {
            name: '🔺 Maximum',
            value: `\`${history.max} msgs\``,
            inline: true,
          },
          {
            name: '💬 Total',
            value: `\`${history.total.toLocaleString('fr-FR')} messages\``,
            inline: true,
          }
        )
        .setFooter({
          text: `${config.bot.footer.text} • Données agrégées toutes les heures`,
          iconURL: config.bot.footer.iconUrl,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
