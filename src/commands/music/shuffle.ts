import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';
import { KazagumoTrack } from 'kazagumo';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Mélanger aléatoirement la file d\'attente musicale'),
  category: 'music',
  cooldown: 3,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const queue = guard.player.queue;

    if (queue.size < 2) {
      await interaction.reply({
        embeds: [EmbedService.warning('File insuffisante', 'Il faut au moins **2 pistes** dans la file pour la mélanger.')],
        ephemeral: true,
      });
      return;
    }

    queue.shuffle();

    await interaction.reply({
      embeds: [EmbedService.success('File mélangée', `🔀 **${queue.size}** pistes mélangées aléatoirement.`)],
    });
  },
};

export default command;
