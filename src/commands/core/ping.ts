import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Affiche la latence du bot et de l API Discord'),
  category: 'core',
  cooldown: 3,
  async execute(interaction) {
    const sent = await interaction.reply({
      embeds: [EmbedService.gold('🏓 Ping...', 'Calcul de la latence en cours...')],
      fetchReply: true,
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiPing = Math.round(interaction.client.ws.ping);

    const embed = EmbedService.success(
      'Pong !',
      `**Latence Bot** : \`${latency}ms\`\n**API Discord** : \`${apiPing}ms\``
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
