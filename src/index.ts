import { ShardingManager } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startShardingManager() {
  logger.info('🚀 [SHARD MANAGER] Initializing Flowie Sharding Manager (Florynx Labs)...');

  const token = config.token;
  if (!token || token === 'mock_discord_token_for_dev') {
    logger.warn('[SHARD MANAGER] DISCORD_TOKEN is not set or mock. Running single process fallback.');
    await import('./bot.js');
    return;
  }

  // Determine worker script path (.ts for dev via tsx loader, .js for production dist)
  const isDev = config.nodeEnv !== 'production';
  const workerFile = isDev
    ? path.join(__dirname, 'bot.ts')
    : path.join(__dirname, 'bot.js');

  const totalShards = config.scaling.shardCount as number | 'auto';

  const manager = new ShardingManager(workerFile, {
    token,
    totalShards,
    execArgv: isDev ? ['--import', 'tsx'] : [],
  });

  manager.on('shardCreate', (shard) => {
    logger.info(`[SHARD MANAGER] Launched Shard #${shard.id}`);

    shard.on('death', (proc: any) => {
      logger.error(`[SHARD MANAGER] Shard #${shard.id} process ${proc?.pid ?? 'unknown'} died. Restarting...`);
    });

    shard.on('disconnect', () => {
      logger.warn(`[SHARD MANAGER] Shard #${shard.id} disconnected.`);
    });

    shard.on('reconnecting', () => {
      logger.info(`[SHARD MANAGER] Shard #${shard.id} reconnecting...`);
    });
  });

  try {
    const shards = await manager.spawn();
    logger.info(`[SHARD MANAGER] Successfully spawned ${shards.size} shard(s)!`);
  } catch (err) {
    logger.fatal({ err }, '[SHARD MANAGER] Fatal error while spawning shards');
  }
}

startShardingManager().catch((err) => {
  logger.fatal({ err }, '[SHARD MANAGER] Unhandled error during launcher startup');
});
