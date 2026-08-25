import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Mettre la lecture musicale en pause'),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;

    if (player.paused) {
      await interaction.reply({
        embeds: [EmbedService.warning('Déjà en pause', 'La lecture est déjà en pause. Utilise `/resume` pour reprendre.')],
        ephemeral: true,
      });
      return;
    }

    player.pause(true);
    await interaction.reply({
      embeds: [EmbedService.success('Mis en pause', `La lecture de **${player.queue.current?.title ?? 'la piste en cours'}** a été mise en pause.`)],
    });
  },
};

export default command;
