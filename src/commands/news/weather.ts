import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { NewsService } from '../../services/newsService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Obtenir la météo actuelle d une ville')
    .addStringOption((opt) =>
      opt.setName('ville').setDescription('Nom de la ville (ex: Paris, Lyon, Montreal, Tokyo)').setRequired(true)
    ),
  category: 'news',
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const cityQuery = interaction.options.getString('ville', true);
    const weather = await NewsService.fetchWeather(cityQuery);

    if (!weather) {
      await interaction.editReply({
        embeds: [
          EmbedService.error(
            'Météo Introuvable',
            `Impossible d'obtenir les données météo pour : \`${cityQuery}\`.`
          ),
        ],
      });
      return;
    }

    const embed = EmbedService.create(
      `🌤️ Météo actuelle — ${weather.city}`,
      `Conditions météorologiques en direct :`,
      config.bot.colors.info
    ).addFields(
      { name: '🌡️ Température', value: `\`${weather.tempC}°C\``, inline: true },
      { name: '🌡️ Ressenti', value: `\`${weather.feelsLikeC}°C\``, inline: true },
      { name: '☁️ Condition', value: `\`${weather.condition}\``, inline: true },
      { name: '💧 Humidité', value: `\`${weather.humidity}%\``, inline: true },
      { name: '💨 Vent', value: `\`${weather.windKm} km/h\``, inline: true }
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
