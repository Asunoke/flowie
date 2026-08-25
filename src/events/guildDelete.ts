import { Guild } from 'discord.js';
import { PlanService } from '../services/planService.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { logger } from '../utils/logger.js';

/**
 * Handles guildDelete event when Flowie leaves or is removed from a server
 */
export async function handleGuildDelete(guild: Guild) {
  try {
    logger.info(`[GUILD_LEAVE] Flowie left server "${guild.name}" (${guild.id})`);

    // Release slot in DB
    await PlanService.handleGuildLeave(guild.id);

    // Invalidate Redis config cache
    await GuildConfigService.invalidateGuildConfig(guild.id);
  } catch (err) {
    logger.error({ err, guildId: guild.id }, '[GUILD_LEAVE] Error handling guild leave');
  }
}
