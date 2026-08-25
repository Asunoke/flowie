import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { getMusicSettings, clearIdleTimer } from '../../services/musicService.js';
import { prisma } from '../../database/db.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Activer ou désactiver le mode 24/7 (rester connecté même quand la file est vide)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  category: 'music',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const settings = await getMusicSettings(interaction.guild.id);
    const newState = !settings.alwaysOnEnabled;

    await prisma.musicSettings.update({
      where: { guildId: interaction.guild.id },
      data: { alwaysOnEnabled: newState },
    });

    if (!newState) {
      // Mode disabled: allow idle timer to fire normally now
    } else {
      // Mode enabled: cancel any pending idle disconnect
      clearIdleTimer(interaction.guild.id);
    }

    await interaction.reply({
      embeds: [
        EmbedService.success(
          `Mode 24/7 ${newState ? 'Activé' : 'Désactivé'}`,
          newState
            ? '📡 Flowie restera connecté en vocal même quand la file est vide.'
            : '🔌 Flowie se déconnectera automatiquement après inactivité.'
        ),
      ],
    });
  },
};

export default command;
