import { SlashCommandBuilder, PermissionFlagsBits, GuildMember } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Rendre un membre muet (timeout natif Discord)')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à rendre muet').setRequired(true))
    .addIntegerOption((opt) => opt.setName('minutes').setDescription('Durée en minutes (ex: 60)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison du timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';

    const moderatorMember = interaction.member as GuildMember;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Membre introuvable.')],
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

    if (!targetMember.moderatable) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Impossible de rendre ce membre muet (permissions du bot insuffisantes).')],
        ephemeral: true,
      });
      return;
    }

    const durationMs = minutes * 60 * 1000;
    await targetMember.timeout(durationMs, reason);

    const fullReason = `${reason} (Durée: ${minutes}m)`;
    await ModerationService.createCase(
      interaction.guild.id,
      targetUser.id,
      interaction.user.id,
      'MUTE',
      fullReason,
      interaction.guild
    );

    const embed = EmbedService.success(
      'Membre rendu muet',
      `**Utilisateur** : ${targetUser.tag}\n**Durée** : \`${minutes} minute(s)\`\n**Raison** : ${reason}`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
