import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ConfessionService } from '../../services/confessionService.js';

const confessModlogCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('confess-modlog')
    .setDescription('Révéler l\'auteur d\'une confession (Commande Staff de modération)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((opt) =>
      opt
        .setName('confession')
        .setDescription('Le numéro (#42) ou l\'ID de message de la confession')
        .setRequired(true)
    ),
  category: 'community',
  userPermissions: [PermissionFlagsBits.ManageMessages],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetInput = interaction.options.getString('confession', true);

    await interaction.deferReply({ ephemeral: true });

    try {
      const confession = await ConfessionService.revealAuthor(
        interaction.guild,
        interaction.user.id,
        targetInput
      );

      const authorUser = await interaction.client.users.fetch(confession.authorId).catch(() => null);
      const authorTag = authorUser ? authorUser.tag : confession.authorId;

      const embed = EmbedService.warning(
        `🔍 Modlog — Confession #${confession.number}`,
        `Informations confidentielles d'identification pour la modération :`
      ).addFields(
        { name: '👤 Auteur identifié', value: `<@${confession.authorId}> (\`${authorTag}\`)`, inline: true },
        { name: '🔢 Numéro', value: `\`#${confession.number}\``, inline: true },
        { name: '📅 Date d\'envoi', value: `<t:${Math.floor(confession.createdAt.getTime() / 1000)}:F>`, inline: true },
        { name: '💬 Contenu exact', value: `*"${confession.content}"*`, inline: false }
      ).setFooter({ text: 'Action consignée dans le journal des modérateurs' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [EmbedService.error('Recherche impossible', err.message || 'Confession introuvable.')],
      });
    }
  },
};

export default confessModlogCommand;
