/**
 * musicService.ts
 * Singleton Kazagumo (Shoukaku v4) manager for Flowie.
 * Security note: config.lavalink.password is NEVER logged in any string interpolation.
 */

import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { Kazagumo, KazagumoPlayer, KazagumoTrack, KazagumoQueue, Plugins } from 'kazagumo';
import { Connectors } from 'shoukaku';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from './embedService.js';
import { prisma } from '../database/db.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PlaylistTrack {
  encoded: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _kazagumo: Kazagumo | null = null;

// Map<guildId, NodeJS.Timeout> — idle disconnect timers
const idleTimers = new Map<string, NodeJS.Timeout>();

/**
 * Initialize the Kazagumo (Shoukaku) music manager.
 * MUST be called before client.login().
 */
export function initMusicService(client: Client): Kazagumo {
  if (_kazagumo) return _kazagumo;

  const nodeConfig = {
    name: 'FlowieNode',
    url: `${config.lavalink.host}:${config.lavalink.port}`,
    auth: config.lavalink.password, // ← password passed to Shoukaku, never logged
    secure: config.lavalink.secure,
  };

  _kazagumo = new Kazagumo(
    {
      defaultSearchEngine: 'youtube',
      // Pass through voice updates to Lavalink via Shoukaku
      send: (guildId: string, payload: unknown) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      },
    },
    new Connectors.DiscordJS(client),
    [nodeConfig],
    {
      // Shoukaku reconnect options — exponential-style via reconnectTries + interval
      reconnectTries: 10,
      reconnectInterval: 5000,
      restTimeout: 10000,
      resumeByLibrary: true,
    }
  );

  // ── Node Events ──────────────────────────────────────────────────────

  _kazagumo.shoukaku.on('ready', (name) => {
    logger.info(`[MUSIC] Lavalink node "${name}" connected and ready.`);
  });

  _kazagumo.shoukaku.on('disconnect', (name, count) => {
    logger.warn(`[MUSIC] Lavalink node "${name}" disconnected (${count} players lost). Attempting reconnect…`);
  });

  // Error: deliberately avoid logging anything that could expose the password
  _kazagumo.shoukaku.on('error', (name, error) => {
    logger.error({ nodeName: name, err: { message: error.message, stack: error.stack } }, '[MUSIC] Lavalink node error');
  });

  _kazagumo.shoukaku.on('reconnecting', (name, left, timeout) => {
    logger.info(`[MUSIC] Reconnecting to node "${name}" — ${left} attempts left, next in ${timeout}ms`);
  });

  // ── Player Events ─────────────────────────────────────────────────────

  _kazagumo.on('playerStart', (player: KazagumoPlayer, track: KazagumoTrack) => {
    clearIdleTimer(player.guildId);
    sendNowPlayingEmbed(client, player, track);
  });

  _kazagumo.on('playerEnd', (player: KazagumoPlayer) => {
    if (player.queue.size === 0 && !player.loop) {
      startIdleTimer(client, player);
    }
  });

  _kazagumo.on('playerEmpty', (player: KazagumoPlayer) => {
    startIdleTimer(client, player);
  });

  _kazagumo.on('playerClosed', (player: KazagumoPlayer) => {
    clearIdleTimer(player.guildId);
    logger.info(`[MUSIC] Player closed for guild ${player.guildId}`);
  });

  _kazagumo.on('playerException', (player: KazagumoPlayer, data: any) => {
    logger.error({ guildId: player.guildId, data }, '[MUSIC] Track exception');
    const channel = client.channels.cache.get(player.textId ?? '') as TextChannel | null;
    if (channel) {
      channel.send({
        embeds: [
          EmbedService.error(
            'Erreur de lecture',
            `Une erreur est survenue lors de la lecture d'une piste.\nPassage automatique à la suivante.`
          ),
        ],
      }).catch(() => null);
    }
    try { player.skip(); } catch {}
  });

  _kazagumo.on('playerStuck', (player: KazagumoPlayer, data: any) => {
    logger.warn({ guildId: player.guildId, data }, '[MUSIC] Track stuck, skipping');
    try { player.skip(); } catch {}
  });

  logger.info('[MUSIC] MusicService initialized with Shoukaku v4 + Kazagumo.');
  return _kazagumo;
}

/**
 * Get the already-initialized Kazagumo instance (or null if not yet initialized).
 */
export function getMusicManager(): Kazagumo | null {
  return _kazagumo;
}

// ─── Idle Auto-Disconnect ─────────────────────────────────────────────────

function startIdleTimer(client: Client, player: KazagumoPlayer) {
  clearIdleTimer(player.guildId);

  const timeoutMs = config.music.idleTimeoutSec * 1000;

  const timer = setTimeout(async () => {
    // Re-check: still empty?
    const alwaysOn = await isMusicAlwaysOn(player.guildId);
    if (alwaysOn) return;

    const channel = client.channels.cache.get(player.textId ?? '') as TextChannel | null;
    if (channel) {
      await channel.send({
        embeds: [
          EmbedService.create(
            '🎵 Déconnexion automatique',
            `Aucun membre dans le salon vocal depuis **${config.music.idleTimeoutSec / 60} minutes**. À bientôt ! 👋`,
            config.bot.colors.gold
          ),
        ],
      }).catch(() => null);
    }

    player.destroy();
    idleTimers.delete(player.guildId);
  }, timeoutMs);

  idleTimers.set(player.guildId, timer);
}

export function clearIdleTimer(guildId: string) {
  const existing = idleTimers.get(guildId);
  if (existing) {
    clearTimeout(existing);
    idleTimers.delete(guildId);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function isMusicAlwaysOn(guildId: string): Promise<boolean> {
  try {
    const settings = await prisma.musicSettings.findUnique({ where: { guildId } });
    return settings?.alwaysOnEnabled ?? false;
  } catch {
    return false;
  }
}

async function sendNowPlayingEmbed(client: Client, player: KazagumoPlayer, track: KazagumoTrack) {
  const channel = client.channels.cache.get(player.textId ?? '') as TextChannel | null;
  if (!channel) return;

  const durationStr = formatDuration(track.length ?? 0);
  const requestedBy = track.requester ? `<@${(track.requester as { id: string }).id}>` : 'Inconnu';

  const embed = new EmbedBuilder()
    .setColor(config.bot.colors.primary)
    .setAuthor({ name: '🎵 Maintenant en cours de lecture' })
    .setTitle(track.title)
    .setURL(track.uri ?? null)
    .setThumbnail(track.thumbnail ?? null)
    .addFields(
      { name: '🎤 Artiste', value: track.author ?? 'Inconnu', inline: true },
      { name: '⏱️ Durée', value: durationStr, inline: true },
      { name: '📋 Demandé par', value: requestedBy, inline: true }
    )
    .setFooter({ text: config.bot.footer.text, iconURL: config.bot.footer.iconUrl })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '∞';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function buildProgressBar(position: number, length: number, size = 20): string {
  if (!length) return '`[──────────────────────]`';
  const ratio = Math.min(1, position / length);
  const filled = Math.round(ratio * size);
  const bar = '█'.repeat(filled) + '─'.repeat(size - filled);
  const pct = Math.round(ratio * 100);
  return `\`[${bar}]\` ${pct}%`;
}

// ─── DJ Role Permission Check ─────────────────────────────────────────────

export async function checkDJPermission(
  guildId: string,
  memberId: string,
  memberRoles: string[],
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;

  try {
    const settings = await prisma.musicSettings.findUnique({ where: { guildId } });
    if (!settings?.djRoleId) return true; // No DJ role configured → everyone can use
    return memberRoles.includes(settings.djRoleId);
  } catch {
    return true;
  }
}

// ─── getMusicSettings upsert helper ──────────────────────────────────────

export async function getMusicSettings(guildId: string) {
  return prisma.musicSettings.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}
