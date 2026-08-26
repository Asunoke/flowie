import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ConfessionService } from '../../services/confessionService.js';

const confessCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Poster un message de façon totalement anonyme')
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Votre confession anonyme (ne sera pas affichée avec votre nom)')
        .setMinLength(5)
        .setMaxLength(1000)
        .setRequired(true)
    ),
  category: 'community',
  cooldown: 10,
  async execute(interaction) {
    if (!interaction.guild) return;

    const messageContent = interaction.options.getString('message', true);

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await ConfessionService.submitConfession(
        interaction.guild,
        interaction.user.id,
        messageContent
      );

      const embed = EmbedService.success(
        '🤫 Confession envoyée !',
        `Votre confession anonyme a bien été publiée sous le numéro **#${result.number}**.\n\n` +
          `*Rappel : Votre identité est totalement masquée sur Discord.*`
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [
          EmbedService.error(
            'Envoi impossible',
            err.message || 'Une erreur est survenue lors de l\'envoi de votre confession.'
          ),
        ],
      });
    }
  },
};

export default confessCommand;
