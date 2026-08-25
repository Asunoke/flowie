import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reprendre la lecture musicale après une pause'),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;

    if (!player.paused) {
      await interaction.reply({
        embeds: [EmbedService.warning('Pas en pause', 'La lecture n\'est pas en pause en ce moment.')],
        ephemeral: true,
      });
      return;
    }

    player.pause(false);
    await interaction.reply({
      embeds: [EmbedService.success('Lecture reprise', `La lecture de **${player.queue.current?.title ?? 'la piste en cours'}** a repris.`)],
    });
  },
};

export default command;
