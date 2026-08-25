import { Collection } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Command } from '../types/command.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadCommands(): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const commandsPath = path.join(__dirname, '..', 'commands');

  if (!fs.existsSync(commandsPath)) {
    logger.warn(`Commands directory not found at ${commandsPath}`);
    return commands;
  }

  const categories = fs.readdirSync(commandsPath);

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      try {
        const commandModule = await import(pathToFileURL(filePath).href);
        const command: Command = commandModule.default || commandModule.command;

        if (command && command.data && typeof command.execute === 'function') {
          commands.set(command.data.name, command);
          logger.debug(`Loaded command: /${command.data.name} [${category}]`);
        } else {
          logger.warn(`Invalid command structure in file: ${filePath}`);
        }
      } catch (err) {
        logger.error({ err, filePath }, `Failed to load command file: ${file}`);
      }
    }
  }

  logger.info(`[COMMANDS] Successfully loaded ${commands.size} commands.`);
  return commands;
}
