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

export async function handleReady(client: Client) {


  logger.info(`[ONLINE] Flowie is online! Logged in as ${client.user?.tag}`);

  // Auto-deploy slash commands to Discord on ready
  if (config.token && config.token !== 'mock_discord_token_for_dev' && config.clientId) {
    try {
      const commandsCollection = await loadCommands();
      const commandsData = Array.from(commandsCollection.values()).map((cmd) => cmd.data.toJSON());
      const rest = new REST({ version: '10' }).setToken(config.token);

      if (config.guildId) {
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, config.guildId),
          { body: commandsData }
        );
        logger.info(`[DISCORD] Successfully auto-deployed ${commandsData.length} commands to guild ${config.guildId}!`);
      } else {
        await rest.put(
          Routes.applicationCommands(config.clientId),
          { body: commandsData }
        );
        logger.info(`[DISCORD] Successfully auto-deployed ${commandsData.length} commands globally!`);
      }
    } catch (deployErr) {
      logger.error({ err: deployErr }, '[DISCORD] Failed to auto-deploy commands');
    }
  }

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


  // Initialize Invite Tracking Redis cache on boot & start 10-minute refresh
  for (const [, guild] of client.guilds.cache) {
    await InviteService.cacheGuildInvites(guild);
  }
  InviteService.startPeriodicRefresh(client);

  client.user?.setActivity(`${config.bot.signature} | /help`, {
    type: ActivityType.Watching,
  });
}
