import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { InviteService } from '../../services/inviteService.js';

const invitesResetCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites-reset')
    .setDescription("Remettre à zéro les invitations d'un membre ou de tout le serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt
        .setName('membre')
        .setDescription('Le membre à réinitialiser (laisser vide pour TOUT le serveur)')
        .setRequired(false)
    ),
  category: 'invites',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 10,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre');

    if (targetUser) {
      await InviteService.resetInvites(interaction.guild.id, targetUser.id);
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Réinitialisation effectuée',
            `Toutes les invitations et bonus de ${targetUser} ont été remis à zéro.`
          ),
        ],
      });
    } else {
      await InviteService.resetInvites(interaction.guild.id);
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Réinitialisation complète',
            "Toutes les données d'invitations de ce serveur ont été remises à zéro."
          ),
        ],
      });
    }
  },
};

export default invitesResetCommand;
