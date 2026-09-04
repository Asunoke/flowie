import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { clearIdleTimer } from '../../services/musicService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Arrêter la musique, vider la file d\'attente et déconnecter le bot du vocal'),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;
    const guildId = interaction.guild!.id;

    clearIdleTimer(guildId);
    player.destroy();

    await interaction.reply({
      embeds: [EmbedService.success('Lecture arrêtée', '⏹️ La musique a été arrêtée, la file d\'attente vidée et William a quitté le salon vocal.')],
    });
  },
};

export default command;
