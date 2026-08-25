import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { TicketService } from '../../services/ticketService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Commandes de gestion des tickets')
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Fermer le ticket actuel avec génération de transcript')
        .addStringOption((opt) =>
          opt.setName('raison').setDescription('Raison de la fermeture du ticket').setRequired(false)
        )
    ),
  category: 'tickets',
  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'close') {
      const reason = interaction.options.getString('raison') || 'Aucune raison spécifiée';
      const member = interaction.member as GuildMember;

      const result = await TicketService.closeTicket(interaction.channel, member, reason);

      if (!result.success) {
        if (result.reason === 'not_found') {
          await interaction.reply({
            embeds: [
              EmbedService.error(
                'Commande invalide',
                'Cette commande doit être exécutée dans un salon de ticket ouvert.'
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (result.reason === 'unauthorized') {
          await interaction.reply({
            embeds: [
              EmbedService.error(
                'Permission refusée',
                'Seul le propriétaire du ticket ou un membre de l\'équipe staff peut fermer ce ticket.'
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Une erreur est survenue lors de la fermeture.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};

export default command;
