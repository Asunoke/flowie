import { Client, GatewayIntentBits, Partials, Collection, Events } from 'discord.js';
import { initMusicService } from './services/musicService.js';
import { config } from './config/index.js';
import { connectDB } from './database/db.js';
import { loadCommands } from './utils/commandLoader.js';
import { handleReady } from './events/ready.js';
import { handleInteractionCreate } from './events/interactionCreate.js';
import { handleMessageCreate } from './events/messageCreate.js';
import { handlePresenceUpdate } from './events/presenceUpdate.js';
import { handleGuildMemberAdd } from './events/guildMemberAdd.js';
import { handleGuildMemberRemove } from './events/guildMemberRemove.js';
import { handleGuildMemberUpdate } from './events/guildMemberUpdate.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { handleGuildDelete } from './events/guildDelete.js';
import { handleChannelDelete } from './events/channelDelete.js';
import { handleVoiceStateUpdate } from './events/voiceStateUpdate.js';
import { handleInviteCreate } from './events/inviteCreate.js';
import { handleInviteDelete } from './events/inviteDelete.js';
import { startHealthServer } from './utils/healthServer.js';
import { logger } from './utils/logger.js';
import { Command } from './types/command.js';

// Process Anti-Crash Handlers
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '[PROCESS] Unhandled Rejection caught (crash prevented)');
});

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, '[PROCESS] Uncaught Exception caught (crash prevented)');
});

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates, // Required for Lavalink voice connections
    GatewayIntentBits.GuildInvites, // Required for Invite Tracking
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
});

let commandsCollection = new Collection<string, Command>();

async function main() {
  const shardId = client.shard?.ids[0] ?? 0;
  logger.info(`[SHARD #${shardId}] Starting William Bot Worker...`);

  // Connect Database
  await connectDB();

  // Load commands dynamically
  commandsCollection = await loadCommands();

  // Register events
  client.once(Events.ClientReady, () => {
    handleReady(client);
    startHealthServer(client, shardId);
  });

  client.on('interactionCreate', (interaction) =>
    handleInteractionCreate(interaction, commandsCollection)
  );
  client.on('messageCreate', (message) => handleMessageCreate(message));
  client.on('presenceUpdate', (oldPresence, newPresence) =>
    handlePresenceUpdate(oldPresence, newPresence)
  );
  client.on('guildMemberAdd', (member) => handleGuildMemberAdd(member));
  client.on('guildMemberRemove', (member) => handleGuildMemberRemove(member));
  client.on('guildMemberUpdate', (oldMember, newMember) => handleGuildMemberUpdate(oldMember, newMember));
  client.on('guildCreate', (guild) => handleGuildCreate(guild));
  client.on('guildDelete', (guild) => handleGuildDelete(guild));
  client.on('channelDelete', (channel) => handleChannelDelete(channel));
  client.on('voiceStateUpdate', (oldState, newState) =>
    handleVoiceStateUpdate(oldState, newState)
  );
  client.on('inviteCreate', (invite) => handleInviteCreate(invite));
  client.on('inviteDelete', (invite) => handleInviteDelete(invite));

  // Initialize Lavalink music service BEFORE login (Shoukaku requirement)
  initMusicService(client);

  // Login if token is provided
  if (config.token && config.token !== 'mock_discord_token_for_dev') {
    await client.login(config.token);
  } else {
    logger.info(`[SHARD #${shardId}] DISCORD_TOKEN is mock. Bot worker prepared without login.`);
  }
}

main().catch((err) => {
  logger.fatal({ err }, '[SHARD WORKER] Fatal error during worker startup');
});
