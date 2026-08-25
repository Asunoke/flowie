import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Afficher les statistiques et métriques du serveur'),
  category: 'management',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const guild = interaction.guild;
    await guild.members.fetch(); // Ensure full member cache

    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter((m) => m.user.bot).size;
    const humanCount = totalMembers - botCount;
    const roleCount = guild.roles.cache.size;
    const channelCount = guild.channels.cache.size;

    const embed = EmbedService.gold(`📊 Statistiques — ${guild.name}`, `Métriques générales du serveur`)
      .setThumbnail(guild.iconURL() || null)
      .addFields(
        { name: '👥 Membres totaux', value: `\`${totalMembers}\``, inline: true },
        { name: '👤 Humains', value: `\`${humanCount}\``, inline: true },
        { name: '🤖 Bots', value: `\`${botCount}\``, inline: true },
        { name: '💬 Salons', value: `\`${channelCount}\``, inline: true },
        { name: '🎭 Rôles', value: `\`${roleCount}\``, inline: true },
        { name: '📅 Date de création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
