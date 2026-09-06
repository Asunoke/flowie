import { Client, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from './embedService.js';

// ────────────────────────────────────────────────────────────────────
// Redis Key Helpers
// ────────────────────────────────────────────────────────────────────

/** Round down a timestamp to the nearest 5-minute bucket (for message counting) */
function fiveMinBucket(date: Date = new Date()): number {
  return Math.floor(date.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
}

/** Round down a timestamp to the nearest 15-minute bucket (for active members) */
function fifteenMinBucket(date: Date = new Date()): number {
  return Math.floor(date.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000);
}

/** Round down a timestamp to the nearest hour bucket (for aggregation) */
function hourBucket(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

const MSG_KEY = (guildId: string, ts: number) => `pulse:msg:${guildId}:${ts}`;
const MEM_KEY = (guildId: string, ts: number) => `pulse:mem:${guildId}:${ts}`;
const CHAN_KEY = (guildId: string, ts: number) => `pulse:chan:${guildId}:${ts}`;

// TTL: keep granular Redis keys for 2 hours
const BUCKET_TTL_SEC = 7200;

// ────────────────────────────────────────────────────────────────────
// Public Service
// ────────────────────────────────────────────────────────────────────

export class PulseService {
  private static aggregationTimer: NodeJS.Timeout | null = null;

  // ─── Real-Time Tracking ──────────────────────────────────────────

  /**
   * Track a new message in Redis (non-blocking, fire-and-forget).
   * Increments the 5-min message count bucket and the 15-min channel hash.
   * Also adds the author to the 15-min active member set.
   */
  static async trackMessage(guildId: string, channelId: string, authorId: string): Promise<void> {
    const now = new Date();
    const msgTs = fiveMinBucket(now);
    const memTs = fifteenMinBucket(now);

    const msgKey = MSG_KEY(guildId, msgTs);
    const memKey = MEM_KEY(guildId, memTs);
    const chanKey = CHAN_KEY(guildId, memTs);

    // Increment message count in 5-min bucket
    await redis.incrby(msgKey, 1);
    await redis.expire(msgKey, BUCKET_TTL_SEC);

    // Track active member in 15-min set
    await redis.sadd(memKey, authorId);
    await redis.expire(memKey, BUCKET_TTL_SEC);

    // Increment channel activity in 15-min hash
    await redis.hincrby(chanKey, channelId, 1);
    await redis.expire(chanKey, BUCKET_TTL_SEC);
  }

  /**
   * Track a voice channel join as activity.
   */
  static async trackVoiceActivity(guildId: string, userId: string): Promise<void> {
    const now = new Date();
    const memTs = fifteenMinBucket(now);
    const memKey = MEM_KEY(guildId, memTs);
    await redis.sadd(memKey, userId);
    await redis.expire(memKey, BUCKET_TTL_SEC);
  }

  // ─── Live Pulse Snapshot ────────────────────────────────────────

  /**
   * Compute the current live pulse for a guild.
   * Returns messages/min, active members, top channel, rhythm status, and baseline comparison.
   */
  static async getGuildPulse(guildId: string): Promise<{
    msgsPerMin: number;
    activeMembers: number;
    topChannelId: string | null;
    rhythm: '💓' | '🫀' | '💤';
    rhythmLabel: string;
    baselineDelta: number | null; // % difference vs historical average (null if no history)
    baselineLabel: string;
  }> {
    const now = new Date();

    // ── Messages per minute (sliding 10-min window = 2 × 5-min buckets) ──
    const currentBucket = fiveMinBucket(now);
    const prevBucket = currentBucket - 5 * 60 * 1000;
    const [curr, prev] = await Promise.all([
      redis.get(MSG_KEY(guildId, currentBucket)),
      redis.get(MSG_KEY(guildId, prevBucket)),
    ]);
    const totalMsgs10m = (parseInt(curr ?? '0', 10) || 0) + (parseInt(prev ?? '0', 10) || 0);
    const msgsPerMin = Math.round((totalMsgs10m / 10) * 10) / 10; // 1 decimal

    // ── Active members (15-min window, up to 3 buckets if within window) ──
    const currentMemBucket = fifteenMinBucket(now);
    const prevMemBucket = currentMemBucket - 15 * 60 * 1000;
    // Count current + previous 15-min buckets for a sliding effect
    const [memCurr, memPrev] = await Promise.all([
      redis.scard(MEM_KEY(guildId, currentMemBucket)),
      redis.scard(MEM_KEY(guildId, prevMemBucket)),
    ]);
    // Use current bucket's count; if current bucket is very fresh (<2min), merge prev too
    const minutesInCurrentBucket = (now.getTime() - currentMemBucket) / 60000;
    const activeMembers = minutesInCurrentBucket < 2 ? Math.max(memCurr, memPrev) : memCurr;

    // ── Top active channel ──
    const chanHash = await redis.hgetall(CHAN_KEY(guildId, currentMemBucket));
    let topChannelId: string | null = null;
    if (chanHash && Object.keys(chanHash).length > 0) {
      const sorted = Object.entries(chanHash).sort((a, b) => parseInt(b[1]) - parseInt(a[1]));
      topChannelId = sorted[0][0];
    }

    // ── Historical baseline comparison ──
    const nowHour = hourBucket(now);
    const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
    const hourOfDay = now.getHours();

    // Look back up to 4 weeks for the same hour+day to compute a baseline
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.activitySnapshot.findMany({
      where: {
        guildId,
        hourBucket: { gte: fourWeeksAgo, lt: nowHour },
      },
      select: { hourBucket: true, messageCount: true },
    });

    // Filter snapshots matching same hour + day-of-week
    const matchingSnapshots = snapshots.filter((s: { hourBucket: Date; messageCount: number }) => {
      return s.hourBucket.getHours() === hourOfDay && s.hourBucket.getDay() === dayOfWeek;
    });

    let baselineDelta: number | null = null;
    let baselineLabel = '';
    if (matchingSnapshots.length >= 2) {
      const avgMsgs = matchingSnapshots.reduce((sum: number, s: { messageCount: number }) => sum + s.messageCount, 0) / matchingSnapshots.length;
      // Estimate current hour's total message count from the 10-min rate
      const projectedHourlyMsgs = msgsPerMin * 60;
      if (avgMsgs > 0) {
        baselineDelta = Math.round(((projectedHourlyMsgs - avgMsgs) / avgMsgs) * 100);
        if (baselineDelta > 0) {
          baselineLabel = `+${baselineDelta}% vs habituellement à cette heure`;
        } else if (baselineDelta < 0) {
          baselineLabel = `${baselineDelta}% vs habituellement à cette heure`;
        } else {
          baselineLabel = 'Dans la moyenne habituelle';
        }
      }
    } else {
      baselineLabel = 'Pas encore assez d\'historique';
    }

    // ── Rhythm indicator ──
    let rhythm: '💓' | '🫀' | '💤';
    let rhythmLabel: string;
    if (baselineDelta !== null) {
      if (baselineDelta >= 20) {
        rhythm = '💓';
        rhythmLabel = 'Pouls Fort — activité élevée !';
      } else if (baselineDelta <= -20) {
        rhythm = '💤';
        rhythmLabel = 'Pouls Faible — activité calme';
      } else {
        rhythm = '🫀';
        rhythmLabel = 'Pouls Modéré — rythme normal';
      }
    } else {
      // No baseline: use raw msgs/min heuristic
      if (msgsPerMin >= 3) {
        rhythm = '💓';
        rhythmLabel = 'Pouls Fort — activité élevée !';
      } else if (msgsPerMin >= 0.5) {
        rhythm = '🫀';
        rhythmLabel = 'Pouls Modéré — rythme normal';
      } else {
        rhythm = '💤';
        rhythmLabel = 'Pouls Faible — activité calme';
      }
    }

    return { msgsPerMin, activeMembers, topChannelId, rhythm, rhythmLabel, baselineDelta, baselineLabel };
  }

  // ─── History Sparkline ───────────────────────────────────────────

  private static readonly BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  private static toSparkline(values: number[]): string {
    if (values.length === 0) return '*(aucune donnée)*';
    const max = Math.max(...values);
    if (max === 0) return values.map(() => '▁').join('');
    return values
      .map((v) => {
        const idx = Math.min(Math.floor((v / max) * (PulseService.BARS.length - 1)), PulseService.BARS.length - 1);
        return PulseService.BARS[idx];
      })
      .join('');
  }

  /**
   * Generate history embed data for the last 24h or 7 days.
   */
  static async getGuildHistory(
    guildId: string,
    period: '24h' | '7d'
  ): Promise<{
    sparkline: string;
    labels: string;
    min: number;
    max: number;
    avg: number;
    total: number;
    buckets: number;
  }> {
    const now = new Date();
    const hours = period === '24h' ? 24 : 168;
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const snapshots = await prisma.activitySnapshot.findMany({
      where: { guildId, hourBucket: { gte: since, lte: now } },
      orderBy: { hourBucket: 'asc' },
    });

    if (snapshots.length === 0) {
      return { sparkline: '*(aucune donnée)*', labels: '', min: 0, max: 0, avg: 0, total: 0, buckets: 0 };
    }

    const values = snapshots.map((s: { messageCount: number }) => s.messageCount);
    const total = values.reduce((a: number, b: number) => a + b, 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round(total / values.length);

    const sparkline = PulseService.toSparkline(values);

    // Generate time labels (first + last)
    const fmt = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const labels = period === '24h'
      ? `${fmt(snapshots[0].hourBucket)} → ${fmt(snapshots[snapshots.length - 1].hourBucket)} UTC`
      : `${snapshots[0].hourBucket.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} → ${snapshots[snapshots.length - 1].hourBucket.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`;

    return { sparkline, labels, min, max, avg, total, buckets: snapshots.length };
  }

  // ─── Aggregation Job ─────────────────────────────────────────────

  /**
   * Aggregate completed Redis 5-min buckets into hourly Prisma snapshots.
   * Called on schedule (every hour) and at boot for catch-up.
   */
  static async aggregateHourlySnapshots(client: Client): Promise<void> {
    try {
      const now = new Date();
      const currentHour = hourBucket(now).getTime();

      // Find all guild message bucket keys
      const allMsgKeys = await redis.keys('pulse:msg:*');
      if (allMsgKeys.length === 0) return;

      // Group by guildId + hour
      const hourlyMap = new Map<string, { guildId: string; hourTs: number; msgCount: number }>();

      for (const key of allMsgKeys) {
        // Key format: pulse:msg:<guildId>:<5minTs>
        const parts = key.split(':');
        if (parts.length < 4) continue;
        const guildId = parts[2];
        const bucketTs = parseInt(parts[3], 10);
        if (isNaN(bucketTs)) continue;

        const bucketHour = hourBucket(new Date(bucketTs)).getTime();

        // Only aggregate buckets from *past* completed hours (not the current hour)
        if (bucketHour >= currentHour) continue;

        const mapKey = `${guildId}:${bucketHour}`;
        const count = parseInt((await redis.get(key)) ?? '0', 10) || 0;

        const existing = hourlyMap.get(mapKey) ?? { guildId, hourTs: bucketHour, msgCount: 0 };
        existing.msgCount += count;
        hourlyMap.set(mapKey, existing);
      }

      for (const [, data] of hourlyMap) {
        const { guildId, hourTs, msgCount } = data;
        const hourDate = new Date(hourTs);

        // Find active members count for this guild/hour (from 15-min buckets)
        let activeMembers = 0;
        const activeMemberKeys = await redis.keys(`pulse:mem:${guildId}:*`);
        for (const memKey of activeMemberKeys) {
          const ts = parseInt(memKey.split(':')[3], 10);
          if (isNaN(ts)) continue;
          const memHour = hourBucket(new Date(ts)).getTime();
          if (memHour === hourTs) {
            const cnt = await redis.scard(memKey);
            activeMembers = Math.max(activeMembers, cnt);
          }
        }

        // Find top channel for this guild/hour
        let topChannelId: string | null = null;
        let topChannelCount = 0;
        const chanKeys = await redis.keys(`pulse:chan:${guildId}:*`);
        for (const chanKey of chanKeys) {
          const ts = parseInt(chanKey.split(':')[3], 10);
          if (isNaN(ts)) continue;
          const chanHour = hourBucket(new Date(ts)).getTime();
          if (chanHour !== hourTs) continue;
          const hash = await redis.hgetall(chanKey);
          if (!hash) continue;
          for (const [chanId, cnt] of Object.entries(hash)) {
            const n = parseInt(cnt, 10) || 0;
            if (n > topChannelCount) { topChannelCount = n; topChannelId = chanId; }
          }
        }

        // Upsert ActivitySnapshot
        await prisma.activitySnapshot.upsert({
          where: {
            // Composite unique via index — we use findFirst then create pattern
            // Prisma doesn't support composite unique via index, so we do findFirst + upsert trick
            id: `${guildId}_${hourTs}`,
          },
          update: { messageCount: msgCount, activeMembers, topChannelId },
          create: {
            id: `${guildId}_${hourTs}`,
            guildId,
            hourBucket: hourDate,
            messageCount: msgCount,
            activeMembers,
            topChannelId,
          },
        });

        // Delete processed Redis keys for this hour to free memory
        for (const key of allMsgKeys) {
          const parts = key.split(':');
          if (parts[2] !== guildId) continue;
          const ts = parseInt(parts[3], 10);
          if (isNaN(ts)) continue;
          if (hourBucket(new Date(ts)).getTime() === hourTs) {
            await redis.del(key);
          }
        }

        // ── Alert threshold check ────────────────────────────────
        await PulseService.checkAlertThresholds(client, guildId, msgCount);
      }

      logger.debug(`[PULSE] Aggregated ${hourlyMap.size} hourly snapshot(s).`);
    } catch (err) {
      logger.error({ err }, '[PULSE] Error in aggregateHourlySnapshots');
    }
  }

  // ─── Alert Thresholds ────────────────────────────────────────────

  static async checkAlertThresholds(client: Client, guildId: string, msgCount: number): Promise<void> {
    try {
      const settings = await prisma.pulseAlertSettings.findUnique({ where: { guildId } });
      if (!settings?.channelId) return;

      const channel = await client.channels.fetch(settings.channelId).catch(() => null) as TextChannel | null;
      if (!channel || !channel.isTextBased()) return;

      if (settings.highThreshold !== null && msgCount >= settings.highThreshold) {
        const embed = EmbedService.warning(
          '💓 Activité Anormalement Élevée — Pulse Alert',
          `Le serveur a enregistré **${msgCount} messages** cette heure, dépassant le seuil configuré de **${settings.highThreshold}** msg/h.\n\n` +
          `Cela peut indiquer un événement viral, un raid ou une animation soudaine. Vérifiez les salons actifs.`
        );
        await channel.send({ embeds: [embed] }).catch(() => null);
      } else if (settings.lowThreshold !== null && msgCount <= settings.lowThreshold && msgCount >= 0) {
        const embed = EmbedService.error(
          '💤 Activité Anormalement Basse — Pulse Alert',
          `Le serveur n'a enregistré que **${msgCount} messages** cette heure, en-dessous du seuil configuré de **${settings.lowThreshold}** msg/h.\n\n` +
          `Cela peut indiquer un problème silencieux (salon inaccessible, bot hors-ligne ou événement externe).`
        );
        await channel.send({ embeds: [embed] }).catch(() => null);
      }
    } catch (err) {
      logger.error({ err }, '[PULSE] Error in checkAlertThresholds');
    }
  }

  // ─── Alert Settings ──────────────────────────────────────────────

  static async getAlertSettings(guildId: string) {
    return prisma.pulseAlertSettings.findUnique({ where: { guildId } });
  }

  static async updateAlertSettings(
    guildId: string,
    channelId: string,
    lowThreshold: number | null,
    highThreshold: number | null
  ) {
    return prisma.pulseAlertSettings.upsert({
      where: { guildId },
      update: { channelId, lowThreshold, highThreshold },
      create: { guildId, channelId, lowThreshold, highThreshold },
    });
  }

  // ─── Scheduler + Boot ───────────────────────────────────────────

  /**
   * Called at bot startup.
   * 1. Runs catch-up aggregation for any stale Redis buckets from past hours.
   * 2. Schedules the recurring hourly aggregation job.
   */
  static async init(client: Client): Promise<void> {
    logger.info('[PULSE] Initializing Pulse service...');

    // Boot catch-up: aggregate any pending past-hour buckets immediately
    await PulseService.aggregateHourlySnapshots(client);

    // Schedule recurring aggregation at the top of every hour (+ 2 min buffer)
    PulseService.scheduleNextAggregation(client);

    logger.info('[PULSE] Pulse service initialized.');
  }

  private static scheduleNextAggregation(client: Client): void {
    if (PulseService.aggregationTimer) {
      clearTimeout(PulseService.aggregationTimer);
    }

    const now = new Date();
    // Next hour + 2-minute buffer to ensure all 5-min buckets have been written
    const nextHour = new Date(hourBucket(now).getTime() + 62 * 60 * 1000);
    const msUntilNext = nextHour.getTime() - now.getTime();

    PulseService.aggregationTimer = setTimeout(async () => {
      await PulseService.aggregateHourlySnapshots(client);
      // Schedule the next one recursively
      PulseService.scheduleNextAggregation(client);
    }, msUntilNext);

    logger.debug(`[PULSE] Next aggregation scheduled in ${Math.round(msUntilNext / 60000)} minutes.`);
  }
}
