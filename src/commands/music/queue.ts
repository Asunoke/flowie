import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { formatDuration } from '../../services/musicService.js';
import { musicGuard } from './_musicGuard.js';
import { config } from '../../config/index.js';
import { KazagumoTrack } from 'kazagumo';

const PAGE_SIZE = 10;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Afficher la file d\'attente musicale paginée'),
  category: 'music',
  cooldown: 3,

  async execute(interaction) {
    const guard = await musicGuard(interaction);
    if (!guard.ok || !guard.player) return;

    const player = guard.player;
    const queue = player.queue;
    const tracks = Array.from(queue) as KazagumoTrack[];

    if (tracks.length === 0 && !queue.current) {
      await interaction.reply({
        embeds: [EmbedService.warning('File vide', 'La file d\'attente est vide. Utilise `/play` pour ajouter des pistes.')],
        ephemeral: true,
      });
      return;
    }

    let page = 0;
    const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));

    const buildEmbed = (p: number): EmbedBuilder => {
      const current = queue.current;
      const start = p * PAGE_SIZE;
      const slice = tracks.slice(start, start + PAGE_SIZE);

      const lines = slice.map((t, i) => {
        const pos = start + i + 1;
        const requester = t.requester ? `<@${(t.requester as any).id}>` : '?';
        return `**${pos}.** [${t.title}](${t.uri}) — \`${formatDuration(t.length ?? 0)}\` | ${requester}`;
      });

      const totalDuration = tracks.reduce((acc, t) => acc + (t.length ?? 0), 0);

      return new EmbedBuilder()
        .setColor(config.bot.colors.primary)
        .setTitle(`🎵 File d'attente — ${interaction.guild!.name}`)
        .setDescription(
          (current
            ? `**▶️ En cours :** [${current.title}](${current.uri}) — \`${formatDuration(current.length ?? 0)}\`\n\n`
            : '') +
          (lines.length > 0 ? lines.join('\n') : '`File suivante vide`')
        )
        .addFields({ name: '📊 Statistiques', value: `**${tracks.length}** pistes • Durée totale : \`${formatDuration(totalDuration)}\`` })
        .setFooter({ text: `Page ${p + 1}/${totalPages} • ${config.bot.footer.text}`, iconURL: config.bot.footer.iconUrl })
        .setTimestamp();
    };

    const buildButtons = (p: number) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('queue_prev')
          .setLabel('◀ Précédent')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p === 0),
        new ButtonBuilder()
          .setCustomId('queue_next')
          .setLabel('Suivant ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= totalPages - 1)
      );

    const reply = await interaction.reply({
      embeds: [buildEmbed(page)],
      components: totalPages > 1 ? [buildButtons(page)] : [],
      fetchReply: true,
    });

    if (totalPages <= 1) return;

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (btn) => btn.user.id === interaction.user.id,
    });

    collector.on('collect', async (btn) => {
      if (btn.customId === 'queue_prev') page = Math.max(0, page - 1);
      if (btn.customId === 'queue_next') page = Math.min(totalPages - 1, page + 1);
      await btn.update({ embeds: [buildEmbed(page)], components: [buildButtons(page)] });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  },
};

export default command;
