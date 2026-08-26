import cron, { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { TwitchService, TwitchStream } from './twitchService.js';
import { YouTubeService, YouTubeVideo } from './youtubeService.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class StreamNotifyService {
  private static cronTask: ScheduledTask | null = null;

  /**
   * Replaces variables {streamer}, {title}, {game}, {url} in a custom message string
   */
  static formatMessage(
    template: string,
    vars: { streamer: string; title: string; game: string; url: string }
  ): string {
    return template
      .replace(/\{streamer\}/gi, vars.streamer)
      .replace(/\{title\}/gi, vars.title)
      .replace(/\{game\}/gi, vars.game)
      .replace(/\{url\}/gi, vars.url);
  }

  /**
   * Starts the central notification scheduler (runs every 2 minutes)
   */
  static startScheduler(client: Client) {
    if (this.cronTask) return;

    logger.info('[STREAM_NOTIFY] Starting Stream Notification Central Scheduler (every 2 minutes)...');

    // Run once immediately after 10s delay on boot
    setTimeout(() => {
      this.processAllSubscriptions(client).catch((err) =>
        logger.error({ err }, '[STREAM_NOTIFY] Error in initial notification cycle')
      );
    }, 10000);

    // Schedule every 2 minutes
    this.cronTask = cron.schedule('*/2 * * * *', async () => {
      await this.processAllSubscriptions(client).catch((err) =>
        logger.error({ err }, '[STREAM_NOTIFY] Error in central scheduler loop')
      );
    });
  }

  /**
   * Central processor: fetches all active subscriptions and checks for new streams/videos
   */
  static async processAllSubscriptions(client: Client) {
    try {
      const allSubs = await prisma.streamSubscription.findMany();
      if (allSubs.length === 0) return;

      const twitchSubs = allSubs.filter((s: { platform: string }) => s.platform === 'twitch');
      const youtubeSubs = allSubs.filter((s: { platform: string }) => s.platform === 'youtube');

      // ─── 1. Process Twitch Subscriptions ──────────────────────────────────
      if (twitchSubs.length > 0 && TwitchService.isConfigured()) {
        const uniqueHandles = Array.from(
          new Set<string>(twitchSubs.map((s: { targetHandle: string }) => s.targetHandle.toLowerCase()))
        );
        const liveStreams = await TwitchService.getStreams(uniqueHandles);


        // Map live stream by login handle
        const streamMap = new Map<string, TwitchStream>();
        for (const s of liveStreams) {
          streamMap.set(s.userLogin.toLowerCase(), s);
        }

        for (const sub of twitchSubs) {
          const stream = streamMap.get(sub.targetHandle.toLowerCase());
          if (!stream) continue;

          // Deduplication: notify only if stream ID is different from lastNotifiedId
          if (sub.lastNotifiedId === stream.id) continue;

          const channel = client.channels.cache.get(sub.channelId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            const streamUrl = `https://twitch.tv/${stream.userLogin}`;
            const defaultMsg = `🔴 **${stream.userName}** est actuellement en direct sur Twitch !`;
            const messageText = sub.customMessage
              ? this.formatMessage(sub.customMessage, {
                  streamer: stream.userName,
                  title: stream.title,
                  game: stream.gameName,
                  url: streamUrl,
                })
              : defaultMsg;

            const embed = EmbedService.gold(
              `🎮 ${stream.userName} est EN DIRECT !`,
              `**${stream.title}**\n\n` +
                `🏷️ **Jeu/Catégorie** : \`${stream.gameName}\`\n` +
                `👥 **Spectateurs** : \`${stream.viewerCount.toLocaleString('fr-FR')}\`\n\n` +
                `🔗 [Rejoindre le stream](${streamUrl})`
            )
              .setImage(stream.thumbnailUrl)
              .setURL(streamUrl)
              .setTimestamp(new Date(stream.startedAt));

            await (channel as TextChannel).send({ content: messageText, embeds: [embed] }).catch((err) => {
              logger.warn({ err, subId: sub.id }, '[STREAM_NOTIFY] Failed to post Twitch notification');
            });

            // Update lastNotifiedId in DB
            await prisma.streamSubscription.update({
              where: { id: sub.id },
              data: { lastNotifiedId: stream.id },
            });
          }
        }
      }

      // ─── 2. Process YouTube Subscriptions ─────────────────────────────────
      if (youtubeSubs.length > 0) {
        // Group YouTube subs by targetId (or targetHandle)
        const targetMap = new Map<string, typeof youtubeSubs>();
        for (const sub of youtubeSubs) {
          const key = sub.targetId || sub.targetHandle;
          const list = targetMap.get(key) || [];
          list.push(sub);
          targetMap.set(key, list);
        }

        for (const [targetKey, subs] of targetMap.entries()) {
          const latestVideo: YouTubeVideo | null = await YouTubeService.getLatestVideo(targetKey);
          if (!latestVideo) continue;

          for (const sub of subs) {
            // Deduplication: notify only if video ID is different from lastNotifiedId
            if (sub.lastNotifiedId === latestVideo.id) continue;

            const channel = client.channels.cache.get(sub.channelId);
            if (channel && channel.isTextBased() && 'send' in channel) {
              const defaultMsg = `🔴 **${latestVideo.channelTitle}** a publié une nouvelle vidéo / live YouTube !`;
              const messageText = sub.customMessage
                ? this.formatMessage(sub.customMessage, {
                    streamer: latestVideo.channelTitle,
                    title: latestVideo.title,
                    game: 'YouTube',
                    url: latestVideo.url,
                  })
                : defaultMsg;

              const embed = EmbedService.create(
                `📹 Nouvelle vidéo — ${latestVideo.channelTitle}`,
                `**[${latestVideo.title}](${latestVideo.url})**\n\n` +
                  `🔗 [Regarder sur YouTube](${latestVideo.url})`,
                config.bot.colors.primary
              )
                .setImage(latestVideo.thumbnailUrl)
                .setURL(latestVideo.url);

              if (latestVideo.publishedAt) {
                embed.setTimestamp(new Date(latestVideo.publishedAt));
              }

              await (channel as TextChannel).send({ content: messageText, embeds: [embed] }).catch((err) => {
                logger.warn({ err, subId: sub.id }, '[STREAM_NOTIFY] Failed to post YouTube notification');
              });

              // Update lastNotifiedId in DB
              await prisma.streamSubscription.update({
                where: { id: sub.id },
                data: { lastNotifiedId: latestVideo.id },
              });
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, '[STREAM_NOTIFY] Unexpected error during notification cycle');
    }
  }

  /**
   * Adds a subscription for a guild
   */
  static async addSubscription(
    guildId: string,
    channelId: string,
    platform: 'twitch' | 'youtube',
    targetHandle: string,
    targetId?: string,
    customMessage?: string
  ) {
    // Check max subs limit per guild
    const currentCount = await prisma.streamSubscription.count({
      where: { guildId },
    });

    if (currentCount >= config.stream.maxSubsPerGuild) {
      throw new Error(
        `Limite d'abonnements atteinte pour ce serveur (max: ${config.stream.maxSubsPerGuild}). Supprimez un abonnement existant.`
      );
    }

    const cleanHandle = targetHandle.trim().toLowerCase().replace(/^@/, '');

    // Check if subscription already exists for this channel and target
    const existing = await prisma.streamSubscription.findFirst({
      where: {
        guildId,
        platform,
        targetHandle: cleanHandle,
      },
    });

    if (existing) {
      return prisma.streamSubscription.update({
        where: { id: existing.id },
        data: {
          channelId,
          targetId: targetId || existing.targetId,
          customMessage: customMessage ?? existing.customMessage,
        },
      });
    }

    return prisma.streamSubscription.create({
      data: {
        guildId,
        channelId,
        platform,
        targetHandle: cleanHandle,
        targetId: targetId || null,
        customMessage: customMessage || null,
      },
    });
  }

  /**
   * Removes a subscription for a guild
   */
  static async removeSubscription(guildId: string, platform: 'twitch' | 'youtube', targetHandle: string) {
    const cleanHandle = targetHandle.trim().toLowerCase().replace(/^@/, '');
    const result = await prisma.streamSubscription.deleteMany({
      where: {
        guildId,
        platform,
        targetHandle: cleanHandle,
      },
    });
    return result.count > 0;
  }

  /**
   * Lists all active subscriptions for a guild and platform
   */
  static async listSubscriptions(guildId: string, platform?: 'twitch' | 'youtube') {
    return prisma.streamSubscription.findMany({
      where: {
        guildId,
        platform: platform ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
