import { SlashCommandBuilder, PermissionFlagsBits, GuildMember } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison de l expulsion'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.KickMembers],
  botPermissions: [PermissionFlagsBits.KickMembers],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';

    const moderatorMember = interaction.member as GuildMember;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Membre introuvable sur le serveur.')],
        ephemeral: true,
      });
      return;
    }

    const hierarchy = ModerationService.checkRoleHierarchy(moderatorMember, targetMember);
    if (!hierarchy.allowed) {
      await interaction.reply({
        embeds: [EmbedService.error('Action impossible', hierarchy.reason!)],
        ephemeral: true,
      });
      return;
    }

    if (!targetMember.kickable) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Impossible d expulser ce membre (permissions du bot insuffisantes).')],
        ephemeral: true,
      });
      return;
    }

    await targetMember.kick(reason);

    // Create case & log
    await ModerationService.createCase(
      interaction.guild.id,
      targetUser.id,
      interaction.user.id,
      'KICK',
      reason,
      interaction.guild
    );

    const embed = EmbedService.success(
      'Membre expulsé',
      `**Utilisateur** : ${targetUser.tag} (\`${targetUser.id}\`)\n**Raison** : ${reason}`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
