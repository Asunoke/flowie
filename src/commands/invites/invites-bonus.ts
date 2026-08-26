import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { InviteService } from '../../services/inviteService.js';

const invitesBonusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites-bonus')
    .setDescription("Ajouter ou retirer manuellement un bonus/malus d'invitations à un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre ciblé').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('nombre')
        .setDescription("Nombre d'invites à ajouter (positif) ou retirer (négatif)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('raison').setDescription('Raison de la modification').setRequired(false)
    ),
  category: 'invites',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('nombre', true);
    const reason = interaction.options.getString('raison') || 'Ajustement manuel staff';

    await InviteService.addBonus(interaction.guild.id, targetUser.id, amount, reason);

    const stats = await InviteService.getMemberInvites(interaction.guild.id, targetUser.id);

    const embed = EmbedService.success(
      "Bonus d'invitations mis à jour",
      `Un ajustement de **${amount >= 0 ? '+' : ''}${amount}** invites a été appliqué à ${targetUser}.\nRaison : *${reason}*\nNouveau total validé : **${stats.totalValid}**.`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default invitesBonusCommand;
