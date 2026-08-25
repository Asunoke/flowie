import { SlashCommandBuilder, PermissionFlagsBits, TextChannel } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouiller un salon textuel pour empêcher l envoi de messages')
    .addChannelOption((opt) => opt.setName('salon').setDescription('Le salon à verrouiller'))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison du verrouillage'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const channelOption = interaction.options.getChannel('salon') || interaction.channel;
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';

    if (!channelOption || !(channelOption instanceof TextChannel)) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Veuillez spécifier un salon textuel valide.')],
        ephemeral: true,
      });
      return;
    }

    await channelOption.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false,
    });

    const embed = EmbedService.warning(
      '🔒 Salon Verrouillé',
      `Ce salon a été verrouillé par ${interaction.user}.\n**Raison** : ${reason}`
    );

    await channelOption.send({ embeds: [embed] });
    await interaction.reply({
      embeds: [EmbedService.success('Verrouillage réussi', `Le salon ${channelOption} a été verrouillé.`)],
      ephemeral: true,
    });
  },
};

export default command;
