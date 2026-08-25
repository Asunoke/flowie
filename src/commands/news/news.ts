import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { NewsService } from '../../services/newsService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('Obtenir les derniers titres d actualité résumés sur un sujet ou flux')
    .addStringOption((opt) =>
      opt.setName('sujet').setDescription('Sujet ou URL de flux RSS (ex: tech, france, gaming)').setRequired(true)
    ),
  category: 'news',
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString('sujet', true);

    try {
      const items = await NewsService.fetchHeadlines(query);

      if (items.length === 0) {
        await interaction.editReply({
          embeds: [EmbedService.warning('Aucune actualité', `Aucun résultat récent trouvé pour : \`${query}\`.`)],
        });
        return;
      }

      const fields = items.map((item) => ({
        name: `📰 ${item.title}`,
        value: `> ${item.snippet}\n🔗 [Lire sur le site original](${item.link})`,
        inline: false,
      }));

      const embed = EmbedService.create(
        `📡 Actualités — ${query.toUpperCase()}`,
        `Voici les 5 derniers titres résumés (*respect des règles de citation*) :`,
        config.bot.colors.primary
      ).addFields(fields);

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [EmbedService.error('Erreur Actualités', err.message || 'Impossible de récupérer les actualités.')],
      });
    }
  },
};

export default command;
