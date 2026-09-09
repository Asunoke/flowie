import { Client, ActivityType, REST, Routes } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { GiveawayService } from '../services/giveawayService.js';
import { loadCommands } from '../utils/commandLoader.js';
import { NewsService } from '../services/newsService.js';
import { TempVoiceService } from '../services/tempVoiceService.js';
import { InviteService } from '../services/inviteService.js';

import { StreamNotifyService } from '../services/streamNotifyService.js';
import { BirthdayService } from '../services/birthdayService.js';
import { TimeCapsuleService } from '../services/timeCapsuleService.js';
import { PulseService } from '../services/pulseService.js';

export async function handleReady(client: Client) {


  logger.info(`[ONLINE] William is online! Logged in as ${client.user?.tag}`);

  // Slash commands are deployed via 'pnpm deploy:commands' to prevent API rate limits & console log spam on startup
  logger.info('[DISCORD] Slash commands ready (use "pnpm deploy:commands" to sync with Discord API)');

  // Restore active giveaways from DB
  await GiveawayService.restoreGiveaways(client);

  // Clean up orphaned temp voice channels on boot
  await TempVoiceService.cleanupOrphanedChannels(client);

  // Start RSS News Feed scheduler
  NewsService.startScheduler(client);

  // Start Stream Notification scheduler (Twitch & YouTube)
  StreamNotifyService.startScheduler(client);

  // Start Daily Birthday scheduler
  BirthdayService.startScheduler(client);

  // Start Time Capsule scheduler (date & member count checks)
  TimeCapsuleService.startScheduler(client);


  // Initialize Invite Tracking Redis cache on boot & start 10-minute refresh
  for (const [, guild] of client.guilds.cache) {
    await InviteService.cacheGuildInvites(guild);
  }
  InviteService.startPeriodicRefresh(client);

  // Initialize Pulse activity tracking and aggregation scheduler
  PulseService.init(client).catch((err) => logger.error({ err }, '[PULSE] Failed to initialize Pulse service'));

  client.user?.setActivity(`${config.bot.signature} | /help`, {
    type: ActivityType.Watching,
  });
}
