import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { BirthdayService } from '../../services/birthdayService.js';

const configBirthdayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config-birthday')
    .setDescription('Configurer le salon d\'annonce et le rôle d\'anniversaire')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon où poster les annonces d\'anniversaire')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addRoleOption((opt) =>
      opt
        .setName('rôle')
        .setDescription('Rôle temporaire attribué le jour de l\'anniversaire (retiré le lendemain)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt.setName('actif').setDescription('Activer ou désactiver les annonces').setRequired(false)
    ),
  category: 'community',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetChannel = interaction.options.getChannel('salon', true);
    const targetRole = interaction.options.getRole('rôle');
    const enabled = interaction.options.getBoolean('actif') ?? true;

    await BirthdayService.setConfig(
      interaction.guild.id,
      targetChannel.id,
      targetRole?.id || undefined,
      enabled
    );

    const embed = EmbedService.success(
      '🎂 Configuration des Anniversaires mise à jour !',
      `Les paramètres d'anniversaire pour **${interaction.guild.name}** ont été enregistrés avec succès.`
    ).addFields(
      { name: '📢 Salon d\'annonce', value: `<#${targetChannel.id}>`, inline: true },
      { name: '👑 Rôle temporaire (Jour J)', value: targetRole ? `<@&${targetRole.id}>` : '*Aucun*', inline: true },
      { name: '⚡ Statut', value: enabled ? '✅ Actif' : '❌ Désactivé', inline: true }
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default configBirthdayCommand;
