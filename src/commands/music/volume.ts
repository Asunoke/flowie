import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Régler le volume du lecteur musical (0 à 150%)')
    .addIntegerOption((opt) =>
      opt
        .setName('niveau')
        .setDescription('Volume entre 0 et 150')
        .setMinValue(0)
        .setMaxValue(150)
        .setRequired(true)
    ),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const volume = interaction.options.getInteger('niveau', true);
    guard.player.setVolume(volume);

    const volumeEmoji = volume === 0 ? '🔇' : volume < 50 ? '🔈' : volume < 100 ? '🔉' : '🔊';
    await interaction.reply({
      embeds: [EmbedService.success('Volume réglé', `${volumeEmoji} Volume réglé à **${volume}%**.`)],
    });
  },
};

export default command;
