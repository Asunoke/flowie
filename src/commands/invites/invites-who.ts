import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { InviteService } from '../../services/inviteService.js';

const invitesWhoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites-who')
    .setDescription('Savoir qui a invité un membre précis sur le serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à rechercher').setRequired(true)
    ),
  category: 'invites',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const joinRecord = await InviteService.getWhoInvited(interaction.guild.id, targetUser.id);

    if (!joinRecord) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Information indisponible',
            `Aucun enregistrement d'invitation n'a été trouvé pour ${targetUser}.`
          ),
        ],
      });
      return;
    }

    const inviterMention = joinRecord.inviterId
      ? `<@${joinRecord.inviterId}>`
      : '`Inconnu / Aucun`';

    const typeLabel =
      joinRecord.joinType === 'vanity'
        ? '🔗 Vanity URL'
        : joinRecord.joinType === 'widget'
        ? '🌐 Widget Discord'
        : joinRecord.joinType === 'normal'
        ? '📩 Invitation classique'
        : '❓ Inconnu';

    const embed = EmbedService.create(
      `🔍 Traçabilité — ${targetUser.tag}`,
      `Détails de l'arrivée du membre sur le serveur :`
    )
      .addFields(
        { name: "👤 Rejoint par l'invitation de", value: inviterMention, inline: true },
        { name: "🏷️ Type d'arrivée", value: typeLabel, inline: true },
        {
          name: "🔑 Code d'invitation utilisé",
          value: joinRecord.inviteCode ? `\`${joinRecord.inviteCode}\`` : '`N/A`',
          inline: true,
        },
        {
          name: '⏳ Quitté prématurément (< 10 min)',
          value: joinRecord.leftEarly ? '⚠️ Oui (compté fake)' : '✅ Non',
          inline: true,
        },
        {
          name: "📅 Date d'arrivée",
          value: `<t:${Math.floor(joinRecord.joinedAt.getTime() / 1000)}:F>`,
          inline: true,
        }
      )
      .setThumbnail(targetUser.displayAvatarURL());

    await interaction.reply({ embeds: [embed] });
  },
};

export default invitesWhoCommand;
