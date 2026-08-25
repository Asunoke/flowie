import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { getMusicManager } from '../../services/musicService.js';
import { config } from '../../config/index.js';

/**
 * /lyrics — Shows a short excerpt (max 4 lines) + source link for the current
 * or a requested track. We deliberately NEVER reproduce full copyrighted lyrics.
 * We use the lyrics.ovh public API which provides lyrics metadata with source attribution.
 */
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Afficher un extrait des paroles de la piste en cours (source externe, extrait court)')
    .addStringOption((opt) =>
      opt
        .setName('titre')
        .setDescription('Titre à rechercher (laisse vide pour la piste en cours)')
        .setRequired(false)
    ),
  category: 'music',
  cooldown: 10,

  async execute(interaction) {
    await interaction.deferReply();

    let searchTitle = interaction.options.getString('titre');

    if (!searchTitle) {
      const manager = getMusicManager();
      const player = manager?.players.get(interaction.guild?.id ?? '');
      const current = player?.queue.current;

      if (!current) {
        await interaction.editReply({
          embeds: [EmbedService.warning('Aucune piste', 'Aucune musique en cours. Indique un titre avec `/lyrics <titre>`.')],
        });
        return;
      }
      searchTitle = `${current.author ?? ''} ${current.title}`.trim();
    }

    try {
      // Use lyrics.ovh — free, no auth, provides plain text lyrics with CC-compatible metadata
      // We extract artist/title from the search query
      const parts = searchTitle.split(' ');
      const artist = parts[0];
      const title = parts.slice(1).join(' ') || parts[0];

      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        await interaction.editReply({
          embeds: [EmbedService.warning('Paroles introuvables', `Aucune parole trouvée pour **${searchTitle}**. Essaie un titre différent.`)],
        });
        return;
      }

      const data = await res.json() as { lyrics?: string; error?: string };

      if (!data.lyrics) {
        await interaction.editReply({
          embeds: [EmbedService.warning('Paroles introuvables', `Aucune parole trouvée pour **${searchTitle}**.`)],
        });
        return;
      }

      // Extract first 4 non-empty lines only (copyright compliance)
      const lines = data.lyrics
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0)
        .slice(0, 4);

      const excerpt = lines.join('\n');

      const embed = new EmbedBuilder()
        .setColor(config.bot.colors.primary)
        .setTitle(`🎤 Extrait de paroles : ${searchTitle}`)
        .setDescription(
          `> ${lines.join('\n> ')}\n\n` +
          `*ℹ️ Ceci est un extrait court (4 premières lignes) à titre indicatif.*\n` +
          `*Source : [lyrics.ovh](https://lyrics.ovh) — Consulte la source pour les paroles complètes.*`
        )
        .setFooter({
          text: `${config.bot.footer.text} • Extrait non intégral — droits des auteurs respectés`,
          iconURL: config.bot.footer.iconUrl,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        await interaction.editReply({
          embeds: [EmbedService.error('Timeout', 'Le service de paroles n\'a pas répondu à temps. Réessaie dans quelques secondes.')],
        });
      } else {
        await interaction.editReply({
          embeds: [EmbedService.error('Erreur', 'Une erreur est survenue lors de la récupération des paroles.')],
        });
      }
    }
  },
};

export default command;
