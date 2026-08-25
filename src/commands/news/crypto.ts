import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { NewsService } from '../../services/newsService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Obtenir le prix et la variation 24h d une cryptomonnaie')
    .addStringOption((opt) =>
      opt.setName('ticker').setDescription('Nom ou symbole crypto (ex: BTC, ETH, SOL, bitcoin)').setRequired(true)
    ),
  category: 'news',
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString('ticker', true);
    const crypto = await NewsService.fetchCryptoPrice(query);

    if (!crypto) {
      await interaction.editReply({
        embeds: [
          EmbedService.error(
            'Crypto Introuvable',
            `Aucune cryptomonnaie trouvée pour la recherche : \`${query}\`.`
          ),
        ],
      });
      return;
    }

    const changeSign = crypto.change24h >= 0 ? '+' : '';
    const changeColor = crypto.change24h >= 0 ? config.bot.colors.success : config.bot.colors.error;

    const embed = EmbedService.create(
      `🪙 ${crypto.name} (${crypto.symbol})`,
      `Statistiques et cours en direct :`,
      changeColor
    ).addFields(
      { name: '💶 Prix (EUR)', value: `\`${crypto.priceEur.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €\``, inline: true },
      { name: '💵 Prix (USD)', value: `\`$${crypto.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}\``, inline: true },
      { name: '📈 Variation 24h', value: `\`${changeSign}${crypto.change24h.toFixed(2)}%\``, inline: true }
    );

    if (crypto.thumb) {
      embed.setThumbnail(crypto.thumb);
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
