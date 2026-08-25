import { SlashCommandBuilder, PermissionFlagsBits, GuildMember } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre du serveur')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison du bannissement'))
    .addIntegerOption((opt) => opt.setName('jours_messages').setDescription('Nombre de jours de messages à supprimer (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    const deleteMessageDays = interaction.options.getInteger('jours_messages') || 0;

    const moderatorMember = interaction.member as GuildMember;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    // Role Hierarchy check if target is currently in the guild
    if (targetMember) {
      const hierarchy = ModerationService.checkRoleHierarchy(moderatorMember, targetMember);
      if (!hierarchy.allowed) {
        await interaction.reply({
          embeds: [EmbedService.error('Action impossible', hierarchy.reason!)],
          ephemeral: true,
        });
        return;
      }

      if (!targetMember.bannable) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Impossible de bannir ce membre (permissions du bot insuffisantes).')],
          ephemeral: true,
        });
        return;
      }
    }

    await interaction.guild.members.ban(targetUser.id, {
      reason,
      deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60,
    });

    // Create case & log
    await ModerationService.createCase(
      interaction.guild.id,
      targetUser.id,
      interaction.user.id,
      'BAN',
      reason,
      interaction.guild
    );

    const embed = EmbedService.success(
      'Membre banni',
      `**Utilisateur** : ${targetUser.tag} (\`${targetUser.id}\`)\n**Raison** : ${reason}`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
