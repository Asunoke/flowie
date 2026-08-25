import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { ModerationService } from '../../services/moderationService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Afficher les avertissements d un membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre dont vous voulez voir l historique').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const warnings = await ModerationService.getMemberWarnings(interaction.guild.id, targetUser.id);

    if (warnings.length === 0) {
      await interaction.reply({
        embeds: [EmbedService.success('Historique vierge', `${targetUser.tag} n a aucun avertissement enregistre.`)],
      });
      return;
    }

    const embed = EmbedService.gold(
      `📜 Historique d avertissements — ${targetUser.tag}`,
      `Total : \`${warnings.length}\` avertissements`
    );

    warnings.slice(0, 10).forEach((w: { createdAt: Date; reason: string; moderatorId: string }, index: number) => {
      embed.addFields({
        name: `#${index + 1} — ${new Date(w.createdAt).toLocaleDateString('fr-FR')}`,
        value: `**Raison** : ${w.reason}\n**Modérateur** : <@${w.moderatorId}>`,
      });
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
