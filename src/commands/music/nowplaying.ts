import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { formatDuration, buildProgressBar } from '../../services/musicService.js';
import { musicGuard } from './_musicGuard.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Afficher la piste en cours de lecture avec sa progression'),
  category: 'music',
  cooldown: 3,

  async execute(interaction) {
    const guard = await musicGuard(interaction);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;
    const track = player.queue.current;

    if (!track) {
      await interaction.reply({
        embeds: [EmbedService.warning('Aucune piste', 'Aucune piste n\'est en cours de lecture.')],
        ephemeral: true,
      });
      return;
    }

    const position = player.shoukaku.position;
    const length = track.length ?? 0;
    const progressBar = buildProgressBar(position, length);
    const posStr = formatDuration(position);
    const lenStr = formatDuration(length);
    const requestedBy = track.requester ? `<@${(track.requester as any).id}>` : 'Inconnu';

    const loopLabel =
      player.loop === 'track' ? '🔂 Répétition (piste)'
      : player.loop === 'queue' ? '🔁 Répétition (file)'
      : '▶️ Lecture normale';

    const embed = new EmbedBuilder()
      .setColor(config.bot.colors.primary)
      .setAuthor({ name: '🎵 En cours de lecture' })
      .setTitle(track.title)
      .setURL(track.uri ?? null)
      .setThumbnail(track.thumbnail ?? null)
      .setDescription(`${progressBar}\n\`${posStr}\` / \`${lenStr}\``)
      .addFields(
        { name: '🎤 Artiste', value: track.author ?? 'Inconnu', inline: true },
        { name: '🔊 Volume', value: `${player.volume}%`, inline: true },
        { name: '📋 Demandé par', value: requestedBy, inline: true },
        { name: '🔁 Mode', value: loopLabel, inline: true },
        { name: '📋 File', value: `${player.queue.size} piste(s) en attente`, inline: true },
      )
      .setFooter({ text: config.bot.footer.text, iconURL: config.bot.footer.iconUrl })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
