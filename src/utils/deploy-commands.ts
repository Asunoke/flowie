import { REST, Routes } from 'discord.js';
import { config } from '../config/index.js';
import { loadCommands } from './commandLoader.js';
import { logger } from './logger.js';

async function deploy() {
  try {
    logger.info('🚀 Registering Slash Commands to Discord...');
    const commandsCollection = await loadCommands();
    const commandsData = Array.from(commandsCollection.values()).map((cmd) => cmd.data.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.token);

    if (config.guildId) {
      logger.info(`Deploying ${commandsData.length} commands to Guild ID: ${config.guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandsData }
      );
      logger.info('✅ Guild commands deployed successfully!');
    } else {
      logger.info(`Deploying ${commandsData.length} commands globally...`);
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
