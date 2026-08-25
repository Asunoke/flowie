import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un utilisateur par son ID Discord')
    .addStringOption((opt) => opt.setName('user_id').setDescription('L ID de l utilisateur à débannir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison du débannissement'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const userId = interaction.options.getString('user_id', true);
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';

    try {
      await interaction.guild.members.unban(userId, reason);

      const embed = EmbedService.success(
        'Utilisateur débanni',
        `**ID** : \`${userId}\`\n**Raison** : ${reason}`
      );
      await interaction.reply({ embeds: [embed] });

      const logEmbed = EmbedService.success('🟢 Membre Débanni', `**ID** : \`${userId}\`\n**Raison** : ${reason}`)
        .addFields({ name: 'Modérateur', value: `${interaction.user.tag}` });
      await ModerationService.sendModLog(interaction.guild.id, logEmbed, interaction.member);
    } catch (err) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', `Impossible de débannir l utilisateur \`${userId}\`. Vérifiez l ID.`)],
        ephemeral: true,
      });
    }
  },
};

export default command;
