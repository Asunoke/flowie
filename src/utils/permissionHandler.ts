import { ChatInputCommandInteraction, PermissionResolvable, MessageFlags } from 'discord.js';
import { EmbedService } from '../services/embedService.js';

export class PermissionHandler {
  /**
   * Check if user has required permissions to execute a command.
   */
  static async checkUserPermissions(
    interaction: ChatInputCommandInteraction,
    requiredPermissions: PermissionResolvable[]
  ): Promise<boolean> {
    if (!interaction.guild || !interaction.memberPermissions) {
      return true;
    }

    // Server owner always has full access
    if (interaction.guild.ownerId === interaction.user.id) {
      return true;
    }

    const missingPerms = requiredPermissions.filter(
      (perm) => !interaction.memberPermissions?.has(perm)
    );

    if (missingPerms.length > 0) {
      const formattedPerms = missingPerms.map((p) => `\`${p}\``).join(', ');
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Permission refusée',
            `Vous n'avez pas les permissions nécessaires pour exécuter cette commande: ${formattedPerms}`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }

    return true;
  }

  /**
   * Check if bot client has required permissions in the current guild/channel.
   */
  static async checkBotPermissions(
    interaction: ChatInputCommandInteraction,
    requiredPermissions: PermissionResolvable[]
  ): Promise<boolean> {
    if (!interaction.guild?.members.me) return true;

    const botMember = interaction.guild.members.me;
    const missingPerms = requiredPermissions.filter(
      (perm) => !botMember.permissions.has(perm)
    );

    if (missingPerms.length > 0) {
      const formattedPerms = missingPerms.map((p) => `\`${p}\``).join(', ');
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Permissions du bot manquantes',
            `Le bot Flowie a besoin des permissions suivantes pour cette action: ${formattedPerms}`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }

    return true;
  }
}
