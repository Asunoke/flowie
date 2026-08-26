import { SlashCommandBuilder } from 'discord.js';
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
  category: 'utility',
  cooldown: 10,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true);
    const proofUrl = interaction.options.getString('preuve') || undefined;

    await interaction.deferReply({ ephemeral: true });

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

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [EmbedService.error('Signalement impossible', err.message || 'Une erreur est survenue.')],
      });
    }
  },
};

export default reportCommand;
