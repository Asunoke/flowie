import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { ModerationService } from '../../services/moderationService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertir un membre et appliquer les escalades automatiques')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à avertir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('Raison de l avertissement').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true);
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Membre introuvable sur ce serveur.')],
        ephemeral: true,
      });
      return;
    }

    if (targetMember.id === interaction.user.id) {
      await interaction.reply({
        embeds: [EmbedService.warning('Impossible', 'Vous ne pouvez pas vous avertir vous-même.')],
        ephemeral: true,
      });
      return;
    }

    const { warnCount, escalationAction, escalationReason } = await ModerationService.issueWarning(
      interaction.guild.id,
      targetMember,
      interaction.user.id,
      reason
    );

    let desc = `**Membre** : ${targetMember.user.tag} (\`${targetMember.id}\`)\n**Raison** : ${reason}\n**Total d avertissements** : \`${warnCount}\``;

    if (escalationAction === 'MUTED') {
      desc += `\n\n⚠️ **Escalade automatique** : Le membre a été rendu muet pour 1 heure (seuil de 3 avertissements atteint).`;
    } else if (escalationAction === 'BANNED') {
      desc += `\n\n🚨 **Escalade automatique** : Le membre a été banni du serveur (seuil de 5 avertissements atteint).`;
    }

    const embed = EmbedService.success('Avertissement donné', desc);
    await interaction.reply({ embeds: [embed] });

    // Mod log entry
    const logEmbed = EmbedService.warning('⚠️ Membre Averti', desc)
      .addFields({ name: 'Modérateur', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` });
    await ModerationService.sendModLog(interaction.guild.id, logEmbed, interaction.member);
  },
};

export default command;
