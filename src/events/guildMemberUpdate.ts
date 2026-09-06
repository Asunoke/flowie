import { GuildMember, PartialGuildMember } from 'discord.js';
import { LegacyService } from '../services/legacyService.js';
import { logger } from '../utils/logger.js';

export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  try {
    await LegacyService.handleMemberRoleUpdate(oldMember, newMember);
  } catch (err) {
    logger.error({ err }, '[EVENT] Error in handleGuildMemberUpdate');
  }
}
