import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { getMusicManager } from '../../services/musicService.js';
import { prisma } from '../../database/db.js';
import { config } from '../../config/index.js';
import { KazagumoTrack } from 'kazagumo';

interface SavedTrack {
  encoded: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
}

const MAX_PLAYLISTS_PER_USER = 10;
const MAX_TRACKS_PER_PLAYLIST = 200;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Gérer vos playlists personnelles sauvegardées')
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('Sauvegarder la file d\'attente actuelle sous un nom')
        .addStringOption((opt) =>
          opt.setName('nom').setDescription('Nom de la playlist').setRequired(true).setMaxLength(32)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('load')
        .setDescription('Charger une playlist sauvegardée dans la file d\'attente')
        .addStringOption((opt) =>
          opt.setName('nom').setDescription('Nom de la playlist à charger').setRequired(true).setMaxLength(32)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lister toutes vos playlists sauvegardées')
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Supprimer une playlist sauvegardée')
        .addStringOption((opt) =>
          opt.setName('nom').setDescription('Nom de la playlist à supprimer').setRequired(true).setMaxLength(32)
        )
    ),
  category: 'music',
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    // ─── SAVE ────────────────────────────────────────────────────────────
    if (sub === 'save') {
      const name = interaction.options.getString('nom', true).toLowerCase();
      const manager = getMusicManager();
      const player = manager?.players.get(guildId);

      if (!player) {
        await interaction.reply({
          embeds: [EmbedService.warning('Aucune lecture', 'Aucune musique n\'est en cours. Lance `/play` d\'abord.')],
          ephemeral: true,
        });
        return;
      }

      const tracks = Array.from(player.queue) as KazagumoTrack[];
      if (player.queue.current) tracks.unshift(player.queue.current);

      if (tracks.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.warning('File vide', 'La file d\'attente est vide, rien à sauvegarder.')],
          ephemeral: true,
        });
        return;
      }

      // Check playlist limit per user
      const existingCount = await prisma.playlist.count({ where: { userId, guildId } });
      const existingNamed = await prisma.playlist.findUnique({ where: { userId_guildId_name: { userId, guildId, name } } });

      if (!existingNamed && existingCount >= MAX_PLAYLISTS_PER_USER) {
        await interaction.reply({
          embeds: [EmbedService.error('Limite atteinte', `Tu as atteint la limite de **${MAX_PLAYLISTS_PER_USER}** playlists. Supprime-en une avec \`/playlist delete\`.`)],
          ephemeral: true,
        });
        return;
      }

      const savedTracks: SavedTrack[] = tracks.slice(0, MAX_TRACKS_PER_PLAYLIST).map((t) => ({
        encoded: t.track ?? '',
        title: t.title,
        author: t.author ?? 'Inconnu',
        uri: t.uri ?? '',
        duration: t.length ?? 0,
      }));

      await prisma.playlist.upsert({
        where: { userId_guildId_name: { userId, guildId, name } },
        create: { userId, guildId, name, tracks: savedTracks as any },
        update: { tracks: savedTracks as any },
      });

      await interaction.reply({
        embeds: [EmbedService.success('Playlist sauvegardée', `📁 **${name}** — **${savedTracks.length}** pistes sauvegardées.`)],
      });
      return;
    }

    // ─── LOAD ────────────────────────────────────────────────────────────
    if (sub === 'load') {
      const name = interaction.options.getString('nom', true).toLowerCase();
      const playlist = await prisma.playlist.findUnique({
        where: { userId_guildId_name: { userId, guildId, name } },
      });

      if (!playlist) {
        await interaction.reply({
          embeds: [EmbedService.error('Playlist introuvable', `Aucune playlist nommée **${name}** trouvée. Vérifie avec \`/playlist list\`.`)],
          ephemeral: true,
        });
        return;
      }

      const manager = getMusicManager();
      if (!manager) {
        await interaction.reply({
          embeds: [EmbedService.error('Musique indisponible', 'Le service musique n\'est pas actif.')],
          ephemeral: true,
        });
        return;
      }

      const savedTracks = playlist.tracks as SavedTrack[];
      await interaction.deferReply();

      // Search and re-resolve each saved track
      let added = 0;
      const player = manager.players.get(guildId);

      if (!player) {
        await interaction.editReply({
          embeds: [EmbedService.warning('Rejoindre un salon vocal', 'Rejoins un salon vocal et utilise `/play` pour démarrer, puis charge la playlist.')],
        });
        return;
      }

      for (const t of savedTracks.slice(0, MAX_TRACKS_PER_PLAYLIST)) {
        try {
          const result = await manager.search(t.uri || t.title, {
            requester: { id: interaction.user.id, tag: interaction.user.tag },
          });
          if (result?.tracks?.[0]) {
            player.queue.add(result.tracks[0]);
            added++;
          }
        } catch {
          // Skip unresolvable track
        }
      }

      if (!player.playing && !player.paused && added > 0) player.play();

      await interaction.editReply({
        embeds: [EmbedService.gold(`📁 Playlist chargée : ${name}`, `**${added}** piste(s) ajoutées à la file d'attente.`)],
      });
      return;
    }

    // ─── LIST ─────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const playlists = await prisma.playlist.findMany({ where: { userId, guildId }, orderBy: { name: 'asc' } });

      if (playlists.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.warning('Aucune playlist', 'Tu n\'as aucune playlist sauvegardée. Utilise `/playlist save <nom>` pour en créer une.')],
          ephemeral: true,
        });
        return;
      }

      const lines = playlists.map((p: any, i: number) => {
        const tracks = p.tracks as SavedTrack[];
        return `**${i + 1}.** \`${p.name}\` — ${tracks.length} piste(s)`;
      });

      await interaction.reply({
        embeds: [
          EmbedService.gold(
            `📁 Tes Playlists (${playlists.length}/${MAX_PLAYLISTS_PER_USER})`,
            lines.join('\n')
          ),
        ],
      });
      return;
    }

    // ─── DELETE ───────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const name = interaction.options.getString('nom', true).toLowerCase();
      const deleted = await prisma.playlist.deleteMany({
        where: { userId, guildId, name },
      });

      if (deleted.count === 0) {
        await interaction.reply({
          embeds: [EmbedService.error('Playlist introuvable', `Aucune playlist nommée **${name}** n'a été trouvée.`)],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [EmbedService.success('Playlist supprimée', `🗑️ La playlist **${name}** a été supprimée définitivement.`)],
      });
    }
  },
};

export default command;
