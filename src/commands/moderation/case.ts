import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Afficher les détails d\'un dossier de modération')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID du dossier de modération').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const caseId = interaction.options.getString('id', true);
    const modCase = await ModerationService.getCaseById(interaction.guild.id, caseId);

    if (!modCase) {
      await interaction.reply({
        embeds: [EmbedService.error('Dossier introuvable', `Aucun dossier de modération ne correspond à l'ID \`${caseId}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const typeLabels: Record<string, string> = {
      WARN: '⚠️ Avertissement',
      MUTE: '🔇 Exclusion temporaire (Mute)',
      UNMUTE: '🔊 Fin d\'exclusion (Unmute)',
      KICK: '🚪 Expulsion (Kick)',
      BAN: '🚨 Bannissement (Ban)',
      UNBAN: '🟢 Débannissement (Unban)',
      SOFTBAN: '🧹 Softban',
      SLOWMODE: '⏱️ Mode Lent',
      NICKNAME: '🏷️ Pseudo',
      PURGE_USER: '🗑️ Purge utilisateur',
    };

    const targetUser = await interaction.client.users.fetch(modCase.targetId).catch(() => null);
    const modUser = await interaction.client.users.fetch(modCase.moderatorId).catch(() => null);

    const embed = EmbedService.create(
      `📁 Dossier de modération #${modCase.id.slice(0, 8)}`,
      `Détails de l'action de modération enregistrée sur le serveur.`,
      config.bot.colors.primary
    ).addFields(
      { name: '🏷️ Type d\'action', value: `\`${typeLabels[modCase.type] || modCase.type}\``, inline: true },
      { name: '📅 Horodatage', value: `<t:${Math.floor(modCase.createdAt.getTime() / 1000)}:F>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '👤 Membre concerné', value: targetUser ? `${targetUser.tag} (\`${targetUser.id}\`)` : `<@${modCase.targetId}>`, inline: true },
      { name: '👮 Modérateur', value: modUser ? `${modUser.tag} (\`${modUser.id}\`)` : `<@${modCase.moderatorId}>`, inline: true },
      { name: '📝 Raison', value: `> ${modCase.reason}`, inline: false }
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
