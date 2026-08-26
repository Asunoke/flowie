import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ReportService } from '../../services/reportService.js';

const configReportCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config-report')
    .setDescription('Configurer le salon de réception des signalements staff')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon privé staff où recevoir les signalements')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt.setName('actif').setDescription('Activer ou désactiver les signalements').setRequired(false)
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetChannel = interaction.options.getChannel('salon', true);
    const enabled = interaction.options.getBoolean('actif') ?? true;

    await ReportService.setConfig(interaction.guild.id, targetChannel.id, enabled);

    const embed = EmbedService.success(
      '🚨 Configuration des Signalements mise à jour !',
      `Le salon de réception des signalements staff pour **${interaction.guild.name}** a été configuré.`
    ).addFields(
      { name: '📢 Salon staff', value: `<#${targetChannel.id}>`, inline: true },
      { name: '⚡ Statut', value: enabled ? '✅ Actif' : '❌ Désactivé', inline: true }
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default configReportCommand;
