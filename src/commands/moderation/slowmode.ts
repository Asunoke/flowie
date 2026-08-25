import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Activer ou désactiver le mode lent sur un salon textuel')
    .addIntegerOption((opt) =>
      opt
        .setName('secondes')
        .setDescription('Délai en secondes entre deux messages (0 pour désactiver)')
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon à modifier (défaut: salon actuel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const seconds = interaction.options.getInteger('secondes', true);
    const targetChannelOption = interaction.options.getChannel('salon');
    const targetChannel = (targetChannelOption || interaction.channel) as TextChannel;

    if (!targetChannel || !(targetChannel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Le salon spécifié n\'est pas un salon textuel valide.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = seconds === 0 ? 'Désactivation du mode lent' : `Activation du mode lent (${seconds}s)`;
    await targetChannel.setRateLimitPerUser(seconds, reason);

    // Create case & log
    await ModerationService.createCase(
      interaction.guild.id,
      targetChannel.id,
      interaction.user.id,
      'SLOWMODE',
      `${reason} dans #${targetChannel.name}`,
      interaction.guild
    );

    const embed = seconds === 0
      ? EmbedService.success('Mode lent désactivé', `Le mode lent a été désactivé dans ${targetChannel}.`)
      : EmbedService.success('Mode lent activé', `Le mode lent est désormais de **${seconds} seconde(s)** dans ${targetChannel}.`);

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
