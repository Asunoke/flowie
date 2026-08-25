import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import os from 'os';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('botstats')
    .setDescription('Statistiques système et performance du bot'),
  category: 'core',
  cooldown: 5,
  async execute(interaction) {
    const memoryUsage = process.memoryUsage();
    const usedRamMb = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    const totalRamMb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const formattedUptime = `${hours}h ${minutes}m ${seconds}s`;

    const guildCount = interaction.client.guilds.cache.size;
    const userCount = interaction.client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    const embed = EmbedService.gold('📊 Statistiques de Flowie', 'Métriques en temps réel du bot et du système')
      .addFields(
        { name: '🌐 Serveurs', value: `\`${guildCount}\``, inline: true },
        { name: '👥 Utilisateurs gérés', value: `\`${userCount}\``, inline: true },
        { name: '⏱️ Uptime', value: `\`${formattedUptime}\``, inline: true },
        { name: '💾 RAM utilisée', value: `\`${usedRamMb} MB\``, inline: true },
        { name: '🖥️ RAM système', value: `\`${totalRamMb} GB\``, inline: true },
        { name: '⚡ Node.js', value: `\`${process.version}\``, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
