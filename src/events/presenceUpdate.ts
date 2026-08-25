import { Presence, TextChannel } from 'discord.js';
import { UptimeService, STATUS_EMOJI, STATUS_LABEL, BotStatus } from '../services/uptimerService.js';
import { EmbedService } from '../services/embedService.js';
import { redis } from '../services/redisService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/** Cache TTL for tracked bot lookups (5 minutes) */
const CACHE_TTL = 300;

/**
 * Handles presenceUpdate events to track bot status changes.
 * Uses Redis cache to avoid querying the DB on every presence update.
 */
export async function handlePresenceUpdate(
  oldPresence: Presence | null,
  newPresence: Presence
) {
  try {
    // Only care about bot users
    const member = newPresence.member;
    if (!member || !member.user.bot) return;

    const guildId = newPresence.guild?.id;
    if (!guildId) return;

    const botId = member.user.id;
    const newStatus = newPresence.status as BotStatus;
    const oldStatus = (oldPresence?.status || 'offline') as BotStatus;

    // Skip if status hasn't actually changed
    if (oldStatus === newStatus) return;

    // Check if this bot is tracked in this guild (with cache)
    const cacheKey = `uptimer:tracked:${guildId}:${botId}`;
    let isTracked: boolean;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        isTracked = cached === '1';
      } else {
        const tracked = await UptimeService.getTrackedBot(guildId, botId);
        isTracked = tracked !== null;
        await redis.set(cacheKey, isTracked ? '1' : '0', 'EX', CACHE_TTL);
      }
    } catch {
      // On cache failure, query DB directly
      const tracked = await UptimeService.getTrackedBot(guildId, botId);
      isTracked = tracked !== null;
    }

    if (!isTracked) return;

    // Record the status change event
    await UptimeService.recordEvent(guildId, botId, newStatus);

    // Check for alert configuration
    const alertConfig = await UptimeService.getAlertConfig(guildId, botId);
    if (!alertConfig?.alertChannelId) return;

    // Only alert on meaningful transitions (online ↔ offline/dnd/idle)
    const wasOnline = oldStatus === 'online';
    const isNowOnline = newStatus === 'online';
    const wasOffline = oldStatus === 'offline' || oldStatus === 'invisible';
    const isNowOffline = newStatus === 'offline' || newStatus === 'invisible';

    if ((wasOnline && isNowOffline) || (wasOffline && isNowOnline)) {
      try {
        const guild = newPresence.guild;
        if (!guild) return;

        const channel = guild.channels.cache.get(alertConfig.alertChannelId);
        if (!channel || !(channel instanceof TextChannel)) return;

        const emoji = STATUS_EMOJI[newStatus] || '⚫';
        const label = STATUS_LABEL[newStatus] || 'Inconnu';
        const arrow = isNowOnline ? '↗️' : '↘️';

        const embed = EmbedService.create(
          `${arrow} Changement de statut`,
          `${emoji} **${member.user.tag}** est maintenant **${label}**`,
          isNowOnline ? config.bot.colors.success : config.bot.colors.error
        ).setThumbnail(member.user.displayAvatarURL({ size: 64 }));

        await channel.send({ embeds: [embed] }).catch(() => null);
      } catch (err) {
        logger.error({ err }, '[UPTIMER] Error sending alert notification');
      }
    }
  } catch (error) {
    logger.error({ err: error }, '[UPTIMER] Error in presenceUpdate handler');
  }
}
