import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChatInputCommandInteraction,
  TextChannel,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { TicketService } from '../../services/ticketService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Publier un panneau de création de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon où envoyer le panneau')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('types')
        .setDescription('Types de tickets séparés par une virgule (ex: Support, Signalement, Partenariat)')
        .setRequired(false)
    ),
  category: 'tickets',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    const channelOption = interaction.options.getChannel('salon', true);
    const typesOption = interaction.options.getString('types');

    if (!(channelOption instanceof TextChannel)) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Le salon sélectionné doit être un salon textuel.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const success = await TicketService.createTicketPanel(
      interaction.guild,
      channelOption,
      typesOption
    );

    if (success) {
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Panneau créé',
            `Le panneau de tickets a été envoyé avec succès dans ${channelOption}.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Erreur',
            'Une erreur est survenue lors de la création du panneau.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export default command;
