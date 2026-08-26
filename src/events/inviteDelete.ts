import { Invite } from 'discord.js';
import { InviteService } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';

export async function handleInviteDelete(invite: Invite) {
  try {
    if (!invite.guild || !(invite.guild instanceof Object) || !('id' in invite.guild)) return;
    const guild = invite.client.guilds.cache.get(invite.guild.id);
    if (guild) {
      await InviteService.cacheGuildInvites(guild);
      logger.debug(`[INVITES] Updated invite cache on inviteDelete for guild ${guild.id}`);
    }
  } catch (err) {
    logger.error({ err }, 'Error handling inviteDelete event');
  }
}
