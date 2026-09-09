import { REST, Routes } from 'discord.js';
import { config } from '../config/index.js';
import { loadCommands } from './commandLoader.js';
import { logger } from './logger.js';

async function deploy() {
  try {
    logger.info('🧹 Resetting all old Slash Commands from Discord API...');
    const commandsCollection = await loadCommands();
    const commandsData = Array.from(commandsCollection.values()).map((cmd) => cmd.data.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.token);

    // 1. Purge Global Commands
    logger.info('Deleting global slash commands...');
    await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
    logger.info('✅ Global commands cleared.');

    // 2. Purge Guild Commands if GUILD_ID is set
    if (config.guildId) {
      logger.info(`Deleting guild slash commands for Guild ID: ${config.guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: [] }
      );
      logger.info('✅ Guild commands cleared.');
    }

    // 3. Deploy fresh current commands
    if (config.guildId) {
      logger.info(`🚀 Deploying ${commandsData.length} fresh commands to Guild ID: ${config.guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandsData }
      );
      logger.info('✅ Guild commands deployed successfully!');
    } else {
      logger.info(`🚀 Deploying ${commandsData.length} fresh commands globally...`);
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commandsData }
      );
      logger.info('✅ Global commands deployed successfully!');
    }
  } catch (error) {
    logger.error({ err: error }, '❌ Error deploying commands');
  }
}

deploy();

