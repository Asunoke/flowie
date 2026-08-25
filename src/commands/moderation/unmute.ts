import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Retirer le timeout d un membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à rétablir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison du rétablissement'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Membre introuvable.')],
        ephemeral: true,
      });
      return;
    }

    await member.timeout(null, reason);

    const embed = EmbedService.success(
      'Timeout retiré',
      `**Utilisateur** : ${targetUser.tag}\n**Raison** : ${reason}`
    );

    await interaction.reply({ embeds: [embed] });

    const logEmbed = EmbedService.success('🔊 Timeout Retiré', `**Utilisateur** : ${targetUser.tag}\n**Raison** : ${reason}`)
      .addFields({ name: 'Modérateur', value: `${interaction.user.tag}` });
    await ModerationService.sendModLog(interaction.guild.id, logEmbed, interaction.member);
  },
};

export default command;
