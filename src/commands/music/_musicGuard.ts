/**
 * Shared guard utility for music commands.
 * Checks: player exists, user in same VC, DJ role permission.
 */
import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from 'discord.js';
import { KazagumoPlayer } from 'kazagumo';
import { getMusicManager, checkDJPermission } from '../../services/musicService.js';
import { EmbedService } from '../../services/embedService.js';


export async function musicGuard(
  interaction: ChatInputCommandInteraction,
  requireDJ = false
): Promise<{ ok: boolean; player?: KazagumoPlayer }> {
  if (!interaction.guild) return { ok: false };

  const manager = getMusicManager();
  if (!manager) {
    await interaction.reply({
      embeds: [EmbedService.error('Musique indisponible', 'Le service musique n\'est pas actif (node Lavalink inaccessible).')],
      ephemeral: true,
    });
    return { ok: false };
  }

  const player = manager.players.get(interaction.guild.id);
  if (!player) {
    await interaction.reply({
      embeds: [EmbedService.warning('Aucune lecture', 'Je ne suis pas en train de jouer de la musique sur ce serveur.')],
      ephemeral: true,
    });
    return { ok: false };
  }

  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== player.voiceId) {
    await interaction.reply({
      embeds: [EmbedService.error('Salon vocal incorrect', 'Tu dois être dans le même salon vocal que moi pour utiliser cette commande.')],
      ephemeral: true,
    });
    return { ok: false };
  }

  if (requireDJ) {
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
    const memberRoles = member.roles.cache.map((r) => r.id);
    const hasDJ = await checkDJPermission(interaction.guild.id, member.id, memberRoles, isAdmin);
    if (!hasDJ) {
      await interaction.reply({
        embeds: [EmbedService.error('Permissions insuffisantes', 'Tu dois avoir le rôle **DJ** pour utiliser cette commande.')],
        ephemeral: true,
      });
      return { ok: false };
    }
  }

  return { ok: true, player };
}
