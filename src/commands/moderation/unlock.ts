import { SlashCommandBuilder, PermissionFlagsBits, TextChannel } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouiller un salon textuel')
    .addChannelOption((opt) => opt.setName('salon').setDescription('Le salon à déverrouiller'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const channelOption = interaction.options.getChannel('salon') || interaction.channel;

    if (!channelOption || !(channelOption instanceof TextChannel)) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Veuillez spécifier un salon textuel valide.')],
        ephemeral: true,
      });
      return;
    }

    await channelOption.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: null,
    });

    const embed = EmbedService.success(
      '🔓 Salon Déverrouillé',
      `Ce salon a été déverrouillé par ${interaction.user}. Vous pouvez de nouveau écrire.`
    );

    await channelOption.send({ embeds: [embed] });
    await interaction.reply({
      embeds: [EmbedService.success('Déverrouillage réussi', `Le salon ${channelOption} a été déverrouillé.`)],
      ephemeral: true,
    });
  },
};

export default command;
