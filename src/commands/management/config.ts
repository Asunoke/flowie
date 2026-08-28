import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { getMusicSettings } from '../../services/musicService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration générale du serveur pour Flowie')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Afficheur la configuration actuelle du serveur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('modlog')
        .setDescription('Définir le salon de logs de modération')
        .addChannelOption((opt) => opt.setName('salon').setDescription('Salon de logs').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('bienvenue')
        .setDescription('Définir le salon de bienvenue')
        .addChannelOption((opt) => opt.setName('salon').setDescription('Salon de bienvenue').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('autorole')
        .setDescription('Définir le rôle automatiquement attribué aux nouveaux membres')
        .addRoleOption((opt) => opt.setName('role').setDescription('Le rôle auto').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('devise')
        .setDescription('Personnaliser le nom de la monnaie du serveur (défaut: Flow)')
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom de la devise').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('antispam')
        .setDescription('Activer ou désactiver le filtre anti-spam / anti-liens')
        .addBooleanOption((opt) => opt.setName('actif').setDescription('Activer l anti-spam').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('antiraid')
        .setDescription('Activer ou désactiver la protection anti-raid')
        .addBooleanOption((opt) => opt.setName('actif').setDescription('Activer l anti-raid').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-category')
        .setDescription('Définir la catégorie où seront créés les tickets')
        .addChannelOption((opt) =>
          opt
            .setName('categorie')
            .setDescription('La catégorie des tickets')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-logs')
        .setDescription('Définir le salon de logs des tickets')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon de logs des tickets')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-staff')
        .setDescription('Définir le rôle staff autorisé sur les tickets')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle staff').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ticket-limit')
        .setDescription('Définir la limite de tickets ouverts simultanément par membre (défaut: 1)')
        .addIntegerOption((opt) =>
          opt
            .setName('limite')
            .setDescription('Nombre max de tickets par membre')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('music-dj-role')
        .setDescription('Définir le rôle DJ requis pour les commandes de contrôle musical (skip/stop/volume)')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle DJ (laisse vide pour retirer la restriction)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('music-volume')
        .setDescription('Définir le volume musical par défaut pour ce serveur (0–150)')
        .addIntegerOption((opt) =>
          opt
            .setName('niveau')
            .setDescription('Volume par défaut (0–150)')
            .setMinValue(0)
            .setMaxValue(150)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('timecapsule')
        .setDescription('Définir le salon d annonce automatique des capsules temporelles')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon d annonce')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    const guildConfig = await GuildConfigService.getGuildConfig(interaction.guild.id);

    if (subcommand === 'voir') {
      const embed = EmbedService.gold(
        `⚙️ Configuration du serveur — ${interaction.guild.name}`,
        'Voici les paramètres actuels enregistrés en base de données'
      ).addFields(
        { name: '📋 Salon ModLog', value: guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : '`Non configuré`', inline: true },
        { name: '👋 Salon Bienvenue', value: guildConfig.welcomeChannelId ? `<#${guildConfig.welcomeChannelId}>` : '`Non configuré`', inline: true },
        { name: '⏳ Salon Capsules', value: guildConfig.timeCapsuleChannelId ? `<#${guildConfig.timeCapsuleChannelId}>` : '`Non configuré`', inline: true },
        { name: '🎭 Auto-Rôle', value: guildConfig.autoRoleId ? `<@&${guildConfig.autoRoleId}>` : '`Non configuré`', inline: true },
        { name: '🪙 Nom Devise', value: `\`${guildConfig.currencyName}\``, inline: true },
        { name: '🌐 Langue', value: `\`${guildConfig.language.toUpperCase()}\``, inline: true },
        { name: '🛡️ Anti-Spam', value: guildConfig.antiSpamEnabled ? '`Activé`' : '`Désactivé`', inline: true },
        { name: '🚨 Anti-Raid', value: guildConfig.antiRaidEnabled ? '`Activé`' : '`Désactivé`', inline: true },
        { name: '📁 Catégorie Tickets', value: guildConfig.ticketCategoryId ? `<#${guildConfig.ticketCategoryId}>` : '`Non configuré`', inline: true },
        { name: '📜 Logs Tickets', value: guildConfig.ticketLogsChannelId ? `<#${guildConfig.ticketLogsChannelId}>` : '`Non configuré`', inline: true },
        { name: '👑 Rôle Staff Tickets', value: guildConfig.ticketStaffRoleId ? `<@&${guildConfig.ticketStaffRoleId}>` : '`Non configuré`', inline: true },
        { name: '🔢 Limite Tickets/Membre', value: `\`${guildConfig.ticketLimit || 1}\``, inline: true }
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'ticket-category') {
      const channel = interaction.options.getChannel('categorie', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { ticketCategoryId: channel.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `La catégorie de tickets a été définie sur ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'ticket-logs') {
      const channel = interaction.options.getChannel('salon', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { ticketLogsChannelId: channel.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le salon de logs de tickets a été défini sur ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'ticket-staff') {
      const role = interaction.options.getRole('role', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { ticketStaffRoleId: role.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le rôle staff pour les tickets a été défini sur ${role}.`)],
      });
      return;
    }

    if (subcommand === 'ticket-limit') {
      const limit = interaction.options.getInteger('limite', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { ticketLimit: limit },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `La limite de tickets simultanés a été définie à **${limit}** par membre.`)],
      });
      return;
    }

    if (subcommand === 'modlog') {
      const channel = interaction.options.getChannel('salon', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { logChannelId: channel.id },
      });
      await GuildConfigService.invalidateGuildConfig(interaction.guild.id);
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le salon de logs a été défini sur ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'bienvenue') {
      const channel = interaction.options.getChannel('salon', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { welcomeChannelId: channel.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le salon de bienvenue a été défini sur ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'autorole') {
      const role = interaction.options.getRole('role', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { autoRoleId: role.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `L auto-rôle a été défini sur ${role}.`)],
      });
      return;
    }

    if (subcommand === 'devise') {
      const currency = interaction.options.getString('nom', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { currencyName: currency },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `La devise du serveur a été nommée **${currency}**.`)],
      });
      return;
    }

    if (subcommand === 'antispam') {
      const active = interaction.options.getBoolean('actif', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { antiSpamEnabled: active },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Anti-Spam', `Filtre anti-spam et anti-liens : ${active ? '**Activé**' : '**Désactivé**'}.`)],
      });
      return;
    }

    if (subcommand === 'antiraid') {
      const active = interaction.options.getBoolean('actif', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { antiRaidEnabled: active },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Anti-Raid', `Protection anti-raid : ${active ? '**Activée**' : '**Désactivée**'}.`)],
      });
      return;
    }

    if (subcommand === 'music-dj-role') {
      const role = interaction.options.getRole('role');
      await prisma.musicSettings.upsert({
        where: { guildId: interaction.guild.id },
        create: { guildId: interaction.guild.id, djRoleId: role?.id ?? null },
        update: { djRoleId: role?.id ?? null },
      });
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Rôle DJ configuré',
            role
              ? `Le rôle **${role}** est désormais requis pour contrôler la musique (skip/stop/volume).`
              : 'La restriction de rôle DJ a été retirée. Tous les membres peuvent contrôler la musique.'
          ),
        ],
      });
      return;
    }

    if (subcommand === 'music-volume') {
      const volume = interaction.options.getInteger('niveau', true);
      await prisma.musicSettings.upsert({
        where: { guildId: interaction.guild.id },
        create: { guildId: interaction.guild.id, defaultVolume: volume },
        update: { defaultVolume: volume },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Volume par défaut', `🔊 Le volume par défaut pour la musique a été réglé à **${volume}%**.`)],
      });
      return;
    }

    if (subcommand === 'timecapsule') {
      const channel = interaction.options.getChannel('salon', true);
      await GuildConfigService.updateGuildConfig(interaction.guild.id, {
        timeCapsuleChannelId: channel.id,
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le salon d annonce des capsules temporelles a été défini sur ${channel}.`)],
      });
      return;
    }
  },
};

export default command;

