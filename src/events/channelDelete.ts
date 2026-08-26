import { DMChannel, GuildChannel, TextChannel } from 'discord.js';
import { TicketService } from '../services/ticketService.js';
import { prisma } from '../database/db.js';
import { logger } from '../utils/logger.js';

/**
 * Handles channelDelete events to detect manually deleted ticket or temp voice channels.
 */
export async function handleChannelDelete(channel: DMChannel | GuildChannel) {
  try {
    if (channel instanceof TextChannel) {
      await TicketService.handleChannelDelete(channel);
    }
    // Clean up temp voice channel DB record if present
    await prisma.tempVoiceChannel.deleteMany({
      where: { channelId: channel.id },
    }).catch(() => null);
  } catch (error) {
    logger.error({ err: error }, '[EVENT] Error in channelDelete listener');
  }
}
