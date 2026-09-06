import { VoiceState, VoiceChannel } from 'discord.js';
import { TempVoiceService } from '../services/tempVoiceService.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from '../services/embedService.js';
import { PulseService } from '../services/pulseService.js';

export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
  try {
    const member = newState.member || oldState.member;
    const guild = newState.guild || oldState.guild;

    if (!member || !guild || member.user.bot) return;

    // Fetch TempVoiceSettings for this guild
    const settings = await TempVoiceService.getSettings(guild.id);
    if (!settings || !settings.enabled) return;

    const joinedChannelId = newState.channelId;
    const leftChannelId = oldState.channelId;

    // ── 1. Member joined the trigger channel ("➕ Créer un vocal") ─────────────
    if (joinedChannelId && joinedChannelId === settings.triggerChannelId) {
      const result = await TempVoiceService.createTempChannel(guild, member);

      if (!result.success) {
        if (result.reason === 'already_exists' && result.existingChannelId) {
          const existingChannel = guild.channels.cache.get(result.existingChannelId);
          if (existingChannel && existingChannel.isVoiceBased()) {
            await member.voice.setChannel(existingChannel as VoiceChannel).catch(() => null);
          }
        } else if (result.reason === 'limit_reached') {
          await member.voice.disconnect('Limite de salons vocaux temporaires atteinte').catch(() => null);
          await member.send({
            embeds: [
              EmbedService.error(
                'Limite atteinte ⚠️',
                `Le nombre maximal de salons vocaux temporaires (**${result.limit}**) a été atteint sur ce serveur.`
              ),
            ],
          }).catch(() => null);
        }
      }
    }

    // ── 2. Member joined an existing temp voice channel ────────────────────────
    if (joinedChannelId && joinedChannelId !== settings.triggerChannelId) {
      const isTempChannel = await TempVoiceService.getTempChannel(joinedChannelId);
      if (isTempChannel) {
        // Cancel any pending deletion timer
        TempVoiceService.cancelChannelDeletion(joinedChannelId);
      }
      // Pulse: track voice join as activity
      PulseService.trackVoiceActivity(guild.id, member.id).catch(() => null);
    }

    // ── 3. Member left a voice channel ──────────────────────────────────────────
    if (leftChannelId && leftChannelId !== joinedChannelId) {
      const tempRecord = await TempVoiceService.getTempChannel(leftChannelId);
      if (tempRecord) {
        const leftChannel = guild.channels.cache.get(leftChannelId);
        if (leftChannel && leftChannel.isVoiceBased() && leftChannel.members.size === 0) {
          await TempVoiceService.scheduleChannelDeletion(leftChannel as VoiceChannel);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in handleVoiceStateUpdate listener');
  }
}
