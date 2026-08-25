import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { musicGuard } from './_musicGuard.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Configurer le mode de répétition de la lecture')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Mode de répétition')
        .setRequired(true)
        .addChoices(
          { name: '🚫 Désactivé', value: 'none' },
          { name: '🔂 Répéter la piste actuelle', value: 'track' },
          { name: '🔁 Répéter toute la file', value: 'queue' }
        )
    ),
  category: 'music',
  cooldown: 2,

  async execute(interaction) {
    const guard = await musicGuard(interaction, true);
    if (!guard.ok || !guard.player) return;

    const mode = interaction.options.getString('mode', true) as 'none' | 'track' | 'queue';
    guard.player.setLoop(mode);

    const modeLabels: Record<string, string> = {
      none: '🚫 Répétition désactivée',
      track: '🔂 Répétition de la piste actuelle activée',
      queue: '🔁 Répétition de toute la file activée',
    };

    await interaction.reply({
      embeds: [EmbedService.success('Mode de répétition', modeLabels[mode])],
    });
  },
};

export default command;
