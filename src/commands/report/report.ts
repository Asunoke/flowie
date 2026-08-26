import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ReportService } from '../../services/reportService.js';

const reportCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Signaler discrètement un membre ou un comportement à l\'équipe staff')
    .addUserOption((opt) =>
      opt
        .setName('membre')
        .setDescription('Le membre à signaler')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('raison')
        .setDescription('La raison détaillée du signalement')
        .setMinLength(5)
        .setMaxLength(500)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('preuve')
        .setDescription('Lien d\'un message ou d\'une image appuyant le signalement')
        .setRequired(false)
    ),
  category: 'report',
  cooldown: 10,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true);
    const proofUrl = interaction.options.getString('preuve') || undefined;

    const deferred = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    if (!deferred && (interaction.replied || interaction.deferred === false)) {
      // Interaction timed out or failed to defer
    }

    try {
      const report = await ReportService.createReport(
        interaction.guild,
        interaction.user.id,
        targetUser.id,
        reason,
        proofUrl
      );

      const embed = EmbedService.success(
        '🚨 Signalement transmis',
        `Votre signalement concernant ${targetUser} a bien été envoyé à l'équipe staff.\n` +
          `Il porte le numéro **#${report.id.slice(-6)}**.\n\n` +
          `*Merci de contribuer à la sécurité du serveur.*`
      );

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    } catch (err: any) {
      const errorEmbed = EmbedService.error('Signalement impossible', err.message || 'Une erreur est survenue.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed] }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
  },
};

export default reportCommand;
