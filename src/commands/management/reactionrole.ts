import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Créer un message interactif avec bouton pour attribuer un rôle')
    .addRoleOption((opt) => opt.setName('role').setDescription('Le rôle à distribuer').setRequired(true))
    .addStringOption((opt) => opt.setName('titre').setDescription('Titre du message').setRequired(true))
    .addStringOption((opt) => opt.setName('description').setDescription('Description du rôle').setRequired(true))
    .addChannelOption((opt) => opt.setName('salon').setDescription('Salon cible (optionnel)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const role = interaction.options.getRole('role', true);
    const title = interaction.options.getString('titre', true);
    const description = interaction.options.getString('description', true);
    const targetChannel = (interaction.options.getChannel('salon') || interaction.channel) as TextChannel;

    if (!targetChannel || !targetChannel.isTextBased()) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Salon textuel invalide.')],
        ephemeral: true,
      });
      return;
    }

    const customId = `role_btn_${role.id}`;

    const button = new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(`Obtenir / Retirer le rôle ${role.name}`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎭');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    const embed = EmbedService.create(title, `${description}\n\n*Cliquez sur le bouton ci-dessous pour obtenir ou retirer le rôle ${role}.*`);

    await targetChannel.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      embeds: [EmbedService.success('Reaction Role créé', `Le message de rôle a été envoyé dans ${targetChannel}.`)],
      ephemeral: true,
    });
  },
};

export default command;
