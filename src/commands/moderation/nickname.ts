import { SlashCommandBuilder, PermissionFlagsBits, GuildMember, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Forcer ou réinitialiser le pseudo d\'un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Forcer un nouveau pseudo pour un membre')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le membre concerné').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('pseudo').setDescription('Le nouveau pseudo').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Réinitialiser le pseudo d\'un membre')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le membre concerné').setRequired(true)
        )
    ),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageNicknames],
  botPermissions: [PermissionFlagsBits.ManageNicknames],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('membre', true);

    const moderatorMember = interaction.member as GuildMember;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Membre introuvable sur ce serveur.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hierarchy = ModerationService.checkRoleHierarchy(moderatorMember, targetMember);
    if (!hierarchy.allowed) {
      await interaction.reply({
        embeds: [EmbedService.error('Action impossible', hierarchy.reason!)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'set') {
      const newNickname = interaction.options.getString('pseudo', true);
      const oldNickname = targetMember.displayName;

      try {
        await targetMember.setNickname(newNickname, `Changement forcé par ${interaction.user.tag}`);

        await ModerationService.createCase(
          interaction.guild.id,
          targetUser.id,
          interaction.user.id,
          'NICKNAME',
          `Pseudo modifié de "${oldNickname}" à "${newNickname}"`,
          interaction.guild
        );

        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Pseudo modifié',
              `Le pseudo de ${targetUser} a été changé en **${newNickname}**.`
            ),
          ],
        });
      } catch (err) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Impossible de modifier le pseudo de ce membre (hiérarchie des rôles ou permissions).')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (subcommand === 'reset') {
      const oldNickname = targetMember.displayName;

      try {
        await targetMember.setNickname(null, `Réinitialisation par ${interaction.user.tag}`);

        await ModerationService.createCase(
          interaction.guild.id,
          targetUser.id,
          interaction.user.id,
          'NICKNAME',
          `Pseudo réinitialisé (ancien: "${oldNickname}")`,
          interaction.guild
        );

        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Pseudo réinitialisé',
              `Le pseudo de ${targetUser} a été réinitialisé.`
            ),
          ],
        });
      } catch (err) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Impossible de réinitialiser le pseudo de ce membre.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
  },
};

export default command;
