import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ConfessionService } from '../../services/confessionService.js';

const configConfessCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config-confess')
    .setDescription('Configurer le salon de publication des confessions anonymes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon Discord où publier les confessions anonymes')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt.setName('actif').setDescription('Activer ou désactiver le système').setRequired(false)
    ),
  category: 'community',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetChannel = interaction.options.getChannel('salon', true);
    const enabled = interaction.options.getBoolean('actif') ?? true;

    await ConfessionService.setConfig(interaction.guild.id, targetChannel.id, enabled);

    const embed = EmbedService.success(
      '🤫 Configuration des Confessions mise à jour !',
      `Le salon de publication des confessions anonymes pour **${interaction.guild.name}** a été enregistré.`
    ).addFields(
      { name: '📢 Salon actif', value: `<#${targetChannel.id}>`, inline: true },
      { name: '⚡ Statut', value: enabled ? '✅ Actif' : '❌ Désactivé', inline: true }
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default configConfessCommand;
