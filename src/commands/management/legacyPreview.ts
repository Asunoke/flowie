import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { LegacyService } from '../../services/legacyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('legacy-preview')
    .setDescription('Prévisualiser l hommage automatique de départ d un membre (Staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt
        .setName('membre')
        .setDescription('Le membre dont vous souhaitez prévisualiser l hommage')
        .setRequired(true)
    ),
  category: 'legacy',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        embeds: [EmbedService.error('Membre introuvable', 'Ce membre n est pas présent sur le serveur.')],
        ephemeral: true,
      });
      return;
    }

    const { embed, stats } = await LegacyService.generatePreview(interaction.guild, member);

    const statusNote = stats.isSignificant
      ? `✅ **Ce membre est éligible à un hommage de départ !**\n**Critères validés :** ${stats.reasons.join(', ')}`
      : `⚠️ **Ce membre NE remplit aucun critère d éligibilité actuellement.**\n*(Ancienneté: ${stats.tenureDays}d, Niveau: ${stats.level}, Invites: ${stats.totalInvites}, Staff: ${stats.staffRoles.length})*\nAucun hommage ne serait publié s il quittait le serveur maintenant.`;

    const infoEmbed = EmbedService.create(
      '🔍 Aperçu du Module Legacy',
      `${statusNote}\n\n*Voici ci-dessous l'embed tel qu'il serait publié dans le salon d hommage :*`
    );

    await interaction.reply({
      embeds: [infoEmbed, embed],
      ephemeral: true,
    });
  },
};

export default command;
