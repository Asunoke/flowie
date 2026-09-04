import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Informations sur le bot William et Florynx Labs'),
  category: 'core',
  cooldown: 5,
  async execute(interaction) {
    const embed = EmbedService.create(
      `👑 ${config.bot.name} — ${config.bot.signature}`,
      `*${config.bot.slogan}*\n\n**William** est un bot Discord multifonction modulaire et haute performance, conçu par **Florynx Labs**.`
    )
      .addFields(
        { name: '🛠️ Stack Technique', value: 'Node.js • TypeScript • Discord.js v14 • PostgreSQL (Prisma) • Redis • Docker', inline: false },
        { name: '✨ Modules principaux', value: '🛡️ Modération • ⚙️ Gestion • 💰 Économie • 🎲 Jeux & Casino • 🎉 Giveaways', inline: false },
        { name: '🏢 Éditeur', value: 'Florynx Labs', inline: true },
        { name: '🏷️ Version', value: '1.0.0 Production-Ready', inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
