import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';
import { KazagumoTrack } from 'kazagumo';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Retirer une piste précise de la file d\'attente')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Position de la piste dans la file (commence à 1)')
        .setMinValue(1)
        .setRequired(true)
    ),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const queue = guard.player.queue;
    const tracks = Array.from(queue) as KazagumoTrack[];
    const pos = interaction.options.getInteger('position', true);

    if (pos > tracks.length) {
      await interaction.reply({
        embeds: [EmbedService.error('Position invalide', `La file ne contient que **${tracks.length}** piste(s). Donne une position entre 1 et ${tracks.length}.`)],
        ephemeral: true,
      });
      return;
    }

    const removed = tracks[pos - 1];
    queue.remove(pos - 1);

    await interaction.reply({
      embeds: [EmbedService.success('Piste retirée', `🗑️ **${removed.title}** a été retirée de la file (position ${pos}).`)],
    });
  },
};

export default command;
