import { SlashCommandBuilder, PermissionFlagsBits, GuildMember, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Bannir puis débannir un membre pour purger ses messages récents sans l\'exclure définitivement')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à softban').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('raison').setDescription('Raison du softban').setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('jours_messages')
        .setDescription('Nombre de jours de messages à purger (1 à 7, défaut: 7)')
        .setMinValue(1)
        .setMaxValue(7)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison') || 'Softban — Purge des messages récents';
    const deleteDays = interaction.options.getInteger('jours_messages') || 7;

    const moderatorMember = interaction.member as GuildMember;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (targetMember) {
      const hierarchy = ModerationService.checkRoleHierarchy(moderatorMember, targetMember);
      if (!hierarchy.allowed) {
        await interaction.reply({
          embeds: [EmbedService.error('Action impossible', hierarchy.reason!)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!targetMember.bannable) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Impossible de bannir ce membre (hiérarchie ou permissions insuffisantes).')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Ban with message deletion
    await interaction.guild.members.ban(targetUser.id, {
      reason: `[SOFTBAN] ${reason}`,
      deleteMessageSeconds: deleteDays * 24 * 60 * 60,
    });

    // Immediately unban
    await interaction.guild.members.unban(targetUser.id, `[SOFTBAN UNBAN] ${reason}`).catch(() => null);

    // Create case in DB & ModLog
    await ModerationService.createCase(
      interaction.guild.id,
      targetUser.id,
      interaction.user.id,
      'SOFTBAN',
      `${reason} (${deleteDays} jour(s) de messages purgés)`,
      interaction.guild
    );

    const embed = EmbedService.success(
      'Softban exécuté',
      `**Membre** : ${targetUser.tag} (\`${targetUser.id}\`)\n**Purge** : \`${deleteDays} jour(s) de messages\`\n**Raison** : ${reason}`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
