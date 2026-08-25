import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';

/** Maximum number of bots that can be tracked per guild */
export const MAX_TRACKED_BOTS = 10;

/** Possible statuses for a tracked bot */
export type BotStatus = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible' | 'not_found';

/** Status emoji mapping */
export const STATUS_EMOJI: Record<string, string> = {
  online: '🟢',
  idle: '🟡',
  dnd: '🔴',
  offline: '⚫',
  invisible: '⚫',
  not_found: '⚪',
};

/** Human-readable status labels */
export const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne',
  idle: 'Inactif',
  dnd: 'Ne pas déranger',
  offline: 'Hors ligne',
  invisible: 'Invisible',
  not_found: 'Introuvable',
};

export class UptimeService {
  /**
   * Add a bot to the tracked list for a guild.
   * Returns { success, reason } to let the caller decide the embed.
   */
  static async addBot(
    guildId: string,
    botId: string,
    addedBy: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      // Check for duplicate
      const existing = await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
      });

      if (existing) {
        return { success: false, reason: 'already_tracked' };
      }

      // Check guild limit
      const count = await prisma.trackedBot.count({ where: { guildId } });
      if (count >= MAX_TRACKED_BOTS) {
        return { success: false, reason: 'limit_reached' };
      }

      await prisma.trackedBot.create({
        data: { guildId, botId, addedBy },
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error adding bot to tracking');
      return { success: false, reason: 'db_error' };
    }
  }

  /**
   * Remove a bot from the tracked list (cascade deletes its events).
   */
  static async removeBot(
    guildId: string,
    botId: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const existing = await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
      });

      if (!existing) {
        return { success: false, reason: 'not_tracked' };
      }

      await prisma.trackedBot.delete({
        where: { id: existing.id },
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error removing bot from tracking');
      return { success: false, reason: 'db_error' };
    }
  }

  /**
   * List all tracked bots for a guild, with their latest event.
   */
  static async listBots(guildId: string) {
    try {
      const bots = await prisma.trackedBot.findMany({
        where: { guildId },
        include: {
          events: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return bots;
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error listing tracked bots');
      return null;
    }
  }

  /**
   * Get a specific tracked bot with its latest event.
   */
  static async getTrackedBot(guildId: string, botId: string) {
    try {
      return await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
        include: {
          events: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error fetching tracked bot');
      return null;
    }
  }

  /**
   * Record a status change event for a tracked bot.
   */
  static async recordEvent(
    guildId: string,
    botId: string,
    status: BotStatus
  ): Promise<boolean> {
    try {
      const tracked = await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
      });

      if (!tracked) return false;

      await prisma.uptimeEvent.create({
        data: {
          trackedBotId: tracked.id,
          status,
        },
      });

      return true;
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error recording event');
      return false;
    }
  }

  /**
   * Mark a tracked bot as not_found (bot left server).
   */
  static async markNotFound(guildId: string, botId: string): Promise<boolean> {
    return this.recordEvent(guildId, botId, 'not_found');
  }

  /**
   * Set the alert channel for a tracked bot.
   */
  static async setAlertChannel(
    guildId: string,
    botId: string,
    channelId: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const existing = await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
      });

      if (!existing) {
        return { success: false, reason: 'not_tracked' };
      }

      await prisma.trackedBot.update({
        where: { id: existing.id },
        data: { alertChannelId: channelId },
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error setting alert channel');
      return { success: false, reason: 'db_error' };
    }
  }

  /**
   * Remove the alert channel for a tracked bot.
   */
  static async removeAlertChannel(
    guildId: string,
    botId: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const existing = await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
      });

      if (!existing) {
        return { success: false, reason: 'not_tracked' };
      }

      await prisma.trackedBot.update({
        where: { id: existing.id },
        data: { alertChannelId: null },
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error removing alert channel');
      return { success: false, reason: 'db_error' };
    }
  }

  /**
   * Get all tracked bots in a guild that have an alert configured for a specific bot.
   */
  static async getAlertConfig(guildId: string, botId: string) {
    try {
      return await prisma.trackedBot.findUnique({
        where: { guildId_botId: { guildId, botId } },
        select: { alertChannelId: true, botId: true, guildId: true },
      });
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error fetching alert config');
      return null;
    }
  }

  /**
   * Get all tracked bots with alerts in a given guild for a specific botId.
   * Used by presenceUpdate to know which channels to notify.
   */
  static async getAllGuildAlerts(botId: string) {
    try {
      return await prisma.trackedBot.findMany({
        where: {
          botId,
          alertChannelId: { not: null },
        },
      });
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error fetching guild alerts');
      return [];
    }
  }

  /**
   * Get all tracked entries across all guilds for a given bot user ID.
   * Used by presenceUpdate to record events across guilds.
   */
  static async getAllEntriesForBot(botId: string) {
    try {
      return await prisma.trackedBot.findMany({
        where: { botId },
      });
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error fetching entries for bot');
      return [];
    }
  }

  /**
   * Calculate uptime percentage for a tracked bot over a given period.
   *
   * Algorithm:
   * 1. Fetch all events in the time window [now - periodMs, now], ordered by timestamp ASC
   * 2. Also fetch the most recent event BEFORE the window to establish the starting state
   * 3. Walk through time intervals between consecutive events
   * 4. Sum up "online" time (status === 'online') — idle and dnd count as "available but not online"
   * 5. Return percentage = (onlineTime / totalPeriod) * 100
   *
   * @param trackedBotId The ID of the TrackedBot record
   * @param periodMs The time window in milliseconds (e.g. 24h = 86400000)
   * @param includeIdle If true, count 'idle' and 'dnd' as online time
   */
  static async calculateUptime(
    trackedBotId: string,
    periodMs: number,
    includeIdle = false
  ): Promise<number | null> {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - periodMs);

      // Events within the window
      const eventsInWindow = await prisma.uptimeEvent.findMany({
        where: {
          trackedBotId,
          timestamp: { gte: windowStart },
        },
        orderBy: { timestamp: 'asc' },
      });

      // Most recent event before the window to know the starting state
      const eventBefore = await prisma.uptimeEvent.findFirst({
        where: {
          trackedBotId,
          timestamp: { lt: windowStart },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (eventsInWindow.length === 0 && !eventBefore) {
        return null; // No data at all
      }

      return this.computeUptimeFromEvents(
        eventBefore ? eventBefore.status : null,
        eventsInWindow.map((e: { status: string; timestamp: Date }) => ({ status: e.status, timestamp: e.timestamp })),
        windowStart,
        now,
        includeIdle
      );
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error calculating uptime');
      return null;
    }
  }

  /**
   * Pure computation function for uptime — easily testable.
   */
  static computeUptimeFromEvents(
    startingStatus: string | null,
    events: { status: string; timestamp: Date }[],
    windowStart: Date,
    windowEnd: Date,
    includeIdle: boolean
  ): number {
    const totalMs = windowEnd.getTime() - windowStart.getTime();
    if (totalMs <= 0) return 0;

    const isOnline = (status: string | null): boolean => {
      if (!status) return false;
      if (status === 'online') return true;
      if (includeIdle && (status === 'idle' || status === 'dnd')) return true;
      return false;
    };

    let onlineMs = 0;
    let currentStatus = startingStatus;
    let currentTime = windowStart.getTime();

    for (const event of events) {
      const eventTime = event.timestamp.getTime();
      const clampedEventTime = Math.max(eventTime, windowStart.getTime());

      if (isOnline(currentStatus)) {
        onlineMs += clampedEventTime - currentTime;
      }

      currentStatus = event.status;
      currentTime = clampedEventTime;
    }

    // Account for time from the last event to windowEnd
    if (isOnline(currentStatus)) {
      onlineMs += windowEnd.getTime() - currentTime;
    }

    return Math.round((onlineMs / totalMs) * 10000) / 100; // 2 decimal precision
  }

  /**
   * Get the last event for a tracked bot.
   */
  static async getLatestEvent(trackedBotId: string) {
    try {
      return await prisma.uptimeEvent.findFirst({
        where: { trackedBotId },
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error({ err: error }, '[UPTIMER] Error fetching latest event');
      return null;
    }
  }
}
