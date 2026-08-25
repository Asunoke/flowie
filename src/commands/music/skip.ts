import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Passer la piste actuelle ou plusieurs pistes de suite')
    .addIntegerOption((opt) =>
      opt
        .setName('nombre')
        .setDescription('Nombre de pistes à passer (défaut : 1)')
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false)
    ),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;
    const amount = interaction.options.getInteger('nombre') ?? 1;
    const currentTitle = player.queue.current?.title ?? 'piste inconnue';

    if (amount === 1) {
      player.skip();
      await interaction.reply({
        embeds: [EmbedService.success('Piste passée', `⏭️ **${currentTitle}** a été ignorée.`)],
      });
    } else {
      // Skip multiple: remove from queue then skip current
      const toRemove = Math.min(amount - 1, player.queue.size);
      for (let i = 0; i < toRemove; i++) {
        player.queue.remove(0);
      }
      player.skip();
      await interaction.reply({
        embeds: [EmbedService.success('Pistes passées', `⏭️ **${amount}** pistes ont été ignorées.`)],
      });
    }
  },
};

export default command;
