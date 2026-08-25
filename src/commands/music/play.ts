import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { getMusicManager, checkDJPermission, getMusicSettings } from '../../services/musicService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Rechercher et jouer une piste ou une URL (YouTube, SoundCloud, Spotify)')
    .addStringOption((opt) =>
      opt
        .setName('recherche')
        .setDescription('Titre, artiste ou URL directe à jouer')
        .setRequired(true)
    ),
  category: 'music',
  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return;

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    // 1. User must be in a voice channel
    if (!voiceChannel) {
      await interaction.reply({
        embeds: [EmbedService.error('Salon vocal requis', 'Tu dois être dans un salon vocal pour utiliser cette commande.')],
        ephemeral: true,
      });
      return;
    }

    // 2. Bot must have permission to join & speak
    const me = interaction.guild.members.me;
    if (me) {
      const perms = voiceChannel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
        await interaction.reply({
          embeds: [EmbedService.error('Permissions insuffisantes', 'Je n\'ai pas la permission de rejoindre ou parler dans ce salon vocal.')],
          ephemeral: true,
        });
        return;
      }
    }

    const manager = getMusicManager();
    if (!manager) {
      await interaction.reply({
        embeds: [EmbedService.error('Musique indisponible', 'Le service de musique n\'est pas encore initialisé ou le node Lavalink est inaccessible.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const query = interaction.options.getString('recherche', true);
    const settings = await getMusicSettings(interaction.guild.id);
    const queueLimit = settings.maxQueueSize || config.music.queueLimit;

    // Check queue size limit
    const existingPlayer = manager.players.get(interaction.guild.id);
    if (existingPlayer && existingPlayer.queue.size >= queueLimit) {
      await interaction.editReply({
        embeds: [EmbedService.warning('File pleine', `La file d'attente est limitée à **${queueLimit} pistes**. Retire des pistes ou attends qu'elles se jouent.`)],
      });
      return;
    }

    // 3. Search
    const result = await manager.search(query, { requester: { id: interaction.user.id, tag: interaction.user.tag } });

    if (!result || result.type === 'SEARCH' && result.tracks.length === 0) {
      await interaction.editReply({
        embeds: [EmbedService.error('Aucun résultat', `Aucune piste trouvée pour : \`${query}\``)],
      });
      return;
    }

    // 4. Create or fetch player
    const player = await manager.createPlayer({
      guildId: interaction.guild.id,
      textId: interaction.channel!.id,
      voiceId: voiceChannel.id,
      volume: settings.defaultVolume ?? 80,
      deaf: true,
      shardId: interaction.guild.shardId,
    });

    // 5. Add tracks to queue
    if (result.type === 'PLAYLIST') {
      // Respect queue limit when adding a playlist
      const tracksToAdd = result.tracks.slice(0, Math.max(0, queueLimit - player.queue.size));
      player.queue.add(tracksToAdd);

      await interaction.editReply({
        embeds: [
          EmbedService.gold(
            `📋 Playlist ajoutée : ${result.playlistName ?? 'Inconnue'}`,
            `**${tracksToAdd.length}** pistes ajoutées à la file d'attente.`
          ),
        ],
      });
    } else {
      const track = result.tracks[0];
      player.queue.add(track);

      if (!player.playing && !player.paused) {
        // Start playing immediately
      } else {
        await interaction.editReply({
          embeds: [
            EmbedService.create(
              `➕ Ajouté à la file`,
              `**[${track.title}](${track.uri})**\n🎤 ${track.author} • ⏱️ ${formatMs(track.length ?? 0)}\n📋 Position : #${player.queue.size}`,
              config.bot.colors.gold
            ),
          ],
        });
        return;
      }
    }

    // Start playback if not already playing
    if (!player.playing && !player.paused) {
      player.play();
    }

    if (result.type !== 'PLAYLIST') {
      // Embed is sent by playerStart event — just acknowledge
      await interaction.editReply({ content: '🎵 Lecture en cours…' }).catch(() => null);
    }
  },
};

function formatMs(ms: number): string {
  if (!ms) return '∞';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default command;
