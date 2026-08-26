import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { InviteService } from '../../services/inviteService.js';

const invitesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription("Afficher le nombre d'invitations d'un membre")
    .addUserOption((opt) =>
      opt
        .setName('membre')
        .setDescription('Le membre dont vous voulez voir les invitations')
        .setRequired(false)
    ),
  category: 'invites',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const stats = await InviteService.getMemberInvites(interaction.guild.id, targetUser.id);

    const embed = EmbedService.create(
      `📩 Invitations — ${targetUser.tag}`,
      `Voici le bilan des invitations pour ${targetUser} :`
    )
      .addFields(
        { name: '✅ Invitations valides', value: `\`${stats.realInvites}\``, inline: true },
        { name: '❌ Fake / Quittés précoce', value: `\`${stats.fakeInvites}\``, inline: true },
        { name: '🎁 Bonus staff', value: `\`${stats.bonus >= 0 ? '+' : ''}${stats.bonus}\``, inline: true },
        { name: '📊 Total comptabilisé', value: `**\`${stats.totalValid}\`**`, inline: true },
        { name: '📈 Total des arrivées', value: `\`${stats.totalJoins}\``, inline: true }
      )
      .setThumbnail(targetUser.displayAvatarURL());

    await interaction.reply({ embeds: [embed] });
  },
};

export default invitesCommand;
