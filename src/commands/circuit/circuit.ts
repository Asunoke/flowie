import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  GuildMember,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { CircuitService, CircuitFinding, CircuitScanResult } from '../../services/circuitService.js';
import { logger } from '../../utils/logger.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('circuit')
    .setDescription('Audit de santé et de configuration du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('scan')
        .setDescription('Lancer un audit complet du serveur (cooldown 1h)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('report')
        .setDescription('Afficher le dernier rapport d audit sauvegardé')
    )
    .addSubcommand((sub) =>
      sub
        .setName('fix')
        .setDescription('Appliquer une correction automatique sécurisée')
        .addStringOption((opt) =>
          opt
            .setName('id_probleme')
            .setDescription('L identifiant du problème à corriger (ex: PERM_EVERYONE_ADMIN)')
            .setRequired(true)
        )
    ),
  category: 'circuit',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    // ── SUBCOMMAND: SCAN ────────────────────────────────────────────────
    if (subcommand === 'scan') {
      const cooldownRemaining = await CircuitService.getCooldownRemaining(interaction.guild.id);

      if (cooldownRemaining > 0) {
        const minutes = Math.ceil(cooldownRemaining / 60);
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Audit en cooldown',
              `Un scan complet a déjà été effectué récemment.\nVeuillez patienter encore **${minutes} minute(s)** avant d'en relancer un.\n\n💡 Utilisez \`/circuit report\` pour consulter les derniers résultats.`
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      try {
        const scanResult = await CircuitService.runScan(interaction.guild);
        await renderReportMessage(interaction, scanResult);
      } catch (err) {
        logger.error({ err, guildId: interaction.guild.id }, 'Error running Circuit scan');
        await interaction.editReply({
          embeds: [EmbedService.error('Erreur d\'audit', 'Une erreur est survenue lors du scan du serveur.')],
        });
      }
      return;
    }

    // ── SUBCOMMAND: REPORT ──────────────────────────────────────────────
    if (subcommand === 'report') {
      await interaction.deferReply();

      const lastReport = await CircuitService.getLastReport(interaction.guild.id);
      if (!lastReport) {
        await interaction.editReply({
          embeds: [
            EmbedService.warning(
              'Aucun rapport disponible',
              'Aucun audit de santé n\'a encore été effectué sur ce serveur.\n\nExecutez la commande \`/circuit scan\` pour lancer votre premier audit.'
            ),
          ],
        });
        return;
      }

      await renderReportMessage(interaction, lastReport);
      return;
    }

    // ── SUBCOMMAND: FIX ─────────────────────────────────────────────────
    if (subcommand === 'fix') {
      const problemId = interaction.options.getString('id_probleme', true).trim();

      const lastReport = await CircuitService.getLastReport(interaction.guild.id);
      if (!lastReport) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Aucun rapport actif',
              'Veuillez d\'abord effectuer un scan avec \`/circuit scan\` avant d\'appliquer une correction.'
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      const finding = lastReport.findings.find((f) => f.id === problemId);
      if (!finding) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Identifiant introuvable',
              `Aucun problème actif correspondant à l'ID \`${problemId}\` n'a été trouvé dans le dernier rapport d'audit.`
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      // If not fixable automatically (requires human judgment)
      if (!finding.fixable) {
        const manualEmbed = EmbedService.create(
          `ℹ️ Recommandation manuelle — [${finding.id}]`,
          `**Problème** : ${finding.title}\n**Description** : ${finding.description}\n\n💡 **Action recommandée** :\n${finding.recommendation}\n\n*Note : Ce problème nécessite un jugement humain et ne peut pas être corrigé automatiquement en 1 clic.*`,
          0x3B82F6
        );

        await interaction.reply({ embeds: [manualEmbed] });
        return;
      }

      // If fixable -> propose confirmation dialog
      const confirmEmbed = EmbedService.create(
        `🔧 Confirmation de la correction — [${finding.id}]`,
        `Vous êtes sur le point d'appliquer la correction automatique suivante :\n\n**Problème** : ${finding.title}\n**Action** : ${finding.recommendation}\n\n⚠️ Souhaitez-vous vraiment exécuter cette action maintenant ?`,
        0xF39C12
      );

      const confirmBtn = new ButtonBuilder()
        .setCustomId(`circuit_fix_confirm_${problemId}`)
        .setLabel('Confirmer la correction')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const cancelBtn = new ButtonBuilder()
        .setCustomId(`circuit_fix_cancel_${problemId}`)
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

      const response = await interaction.reply({
        embeds: [confirmEmbed],
        components: [row],
        fetchReply: true,
      });

      const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on('collect', async (i) => {
        if (i.customId.startsWith('circuit_fix_cancel')) {
          await i.update({
            embeds: [EmbedService.warning('Correction annulée', 'Aucune modification n\'a été apportée au serveur.')],
            components: [],
          });
          collector.stop('cancelled');
          return;
        }

        if (i.customId.startsWith('circuit_fix_confirm')) {
          await i.deferUpdate();

          const fixResult = await CircuitService.applyFix(interaction.guild!, problemId);

          if (fixResult.success) {
            const successEmbed = EmbedService.success(
              'Correction appliquée !',
              `${fixResult.message}\n\n💡 Un nouveau scan est recommandé pour mettre à jour le score du serveur (\`/circuit scan\`).`
            );
            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });
          } else {
            const errorEmbed = EmbedService.error('Échec de la correction', fixResult.message);
            await interaction.editReply({
              embeds: [errorEmbed],
              components: [],
            });
          }
          collector.stop('completed');
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'completed' && reason !== 'cancelled') {
          await interaction.editReply({
            embeds: [EmbedService.warning('Temps écoulé', 'La demande de confirmation a expiré.')],
            components: [],
          }).catch(() => null);
        }
      });

      return;
    }
  },
};

/**
 * Render structured Embed Report with Pagination
 */
async function renderReportMessage(interaction: any, report: CircuitScanResult) {
  const { healthScore, findings, scannedAt } = report;

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  const scoreEmoji = healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴';
  const progressBlocks = Math.round((healthScore / 100) * 10);
  const progressBar = '🟩'.repeat(progressBlocks) + '⬜'.repeat(10 - progressBlocks);

  // Split findings into pages (5 per page)
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(findings.length / pageSize));
  let currentPage = 0;

  const buildEmbedForPage = (page: number) => {
    const embed = EmbedService.create(
      `🔌 Audit de Santé du Serveur — Circuit`,
      `**Score de Santé** : \`${progressBar}\` **${healthScore}/100** ${scoreEmoji}\n` +
        `**Bilan** : 🔴 **${criticalCount}** critique(s) · 🟡 **${warningCount}** attention(s)\n` +
        `**Dernier Scan** : <t:${Math.floor(scannedAt.getTime() / 1000)}:R>\n` +
        `───────────`
    );

    if (findings.length === 0) {
      embed.addFields({
        name: '🟢 Santé Parfaite',
        value: 'Aucun problème détecté ! Votre serveur respecte parfaitement les bonnes pratiques de configuration.',
      });
      return embed;
    }

    const startIdx = page * pageSize;
    const pageFindings = findings.slice(startIdx, startIdx + pageSize);

    pageFindings.forEach((f) => {
      const badge = f.severity === 'critical' ? '🔴 [CRITIQUE]' : '🟡 [ATTENTION]';
      const fixBadge = f.fixable ? ` • 🔧 \`/circuit fix ${f.id}\`` : '';

      embed.addFields({
        name: `${badge} ${f.title} (\`${f.id}\`)`,
        value: `${f.description}\n💡 **Recommandation** : ${f.recommendation}${fixBadge}`,
      });
    });

    if (totalPages > 1) {
      embed.setFooter({ text: `Page ${page + 1}/${totalPages} • William by Florynx Labs` });
    }

    return embed;
  };

  if (totalPages === 1) {
    await interaction.editReply({ embeds: [buildEmbedForPage(0)] });
    return;
  }

  // Multi-page Pagination Buttons
  const getRow = (page: number) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('circuit_prev')
        .setLabel('Précédent')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('circuit_next')
        .setLabel('Suivant')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages - 1)
    );
  };

  const responseMessage = await interaction.editReply({
    embeds: [buildEmbedForPage(0)],
    components: [getRow(0)],
  });

  const collector = responseMessage.createMessageComponentCollector({
    filter: (i: any) => i.user.id === interaction.user.id,
    componentType: ComponentType.Button,
    time: 120000, // 2 minutes
  });

  collector.on('collect', async (i: any) => {
    if (i.customId === 'circuit_prev') {
      currentPage = Math.max(0, currentPage - 1);
    } else if (i.customId === 'circuit_next') {
      currentPage = Math.min(totalPages - 1, currentPage + 1);
    }

    await i.update({
      embeds: [buildEmbedForPage(currentPage)],
      components: [getRow(currentPage)],
    });
  });

  collector.on('end', async () => {
    await interaction.editReply({
      components: [],
    }).catch(() => null);
  });
}

export default command;
