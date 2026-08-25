import { DMChannel, GuildChannel, TextChannel } from 'discord.js';
import { TicketService } from '../services/ticketService.js';
import { logger } from '../utils/logger.js';

/**
 * Handles channelDelete events to detect manually deleted ticket channels.
 */
export async function handleChannelDelete(channel: DMChannel | GuildChannel) {
  try {
    if (!(channel instanceof TextChannel)) return;
    await TicketService.handleChannelDelete(channel);
  } catch (error) {
    logger.error({ err: error }, '[EVENT] Error in channelDelete listener');
  }
}
