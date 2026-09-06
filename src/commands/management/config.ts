import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { getMusicSettings } from '../../services/musicService.js';
import { AuraService } from '../../services/auraService.js';
import { LegacyService } from '../../services/legacyService.js';
import { PulseService } from '../../services/pulseService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration générale du serveur pour William')
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('forge-visibility')
        .setDescription('Mode d affichage des recettes de forge pour les membres')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Visibilité des recettes')
            .setRequired(true)
            .addChoices(
              { name: 'Découvertes (nécessite d avoir au moins 1 composant dans l inventaire)', value: 'discovered' },
              { name: 'Publiques (toutes les recettes sont visibles par tous les membres)', value: 'all' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('aura')
        .setDescription('Activer ou désactiver le module Aura sur le serveur')
        .addBooleanOption((opt) => opt.setName('actif').setDescription('Activer l Aura').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('aura-qualities')
        .setDescription('Gérer les qualités d endorsement (ex: Fiable, Créatif...)')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Action à effectuer')
            .setRequired(true)
            .addChoices(
              { name: 'Voir les qualités', value: 'list' },
              { name: 'Ajouter une qualité', value: 'add' },
              { name: 'Retirer une qualité', value: 'remove' }
            )
        )
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom de la qualité (si ajout/retrait)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('aura-tiers')
        .setDescription('Gérer les paliers d aura et couleurs associées')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Action à effectuer')
            .setRequired(true)
            .addChoices(
              { name: 'Voir les paliers', value: 'list' },
              { name: 'Ajouter/Modifier un palier', value: 'add' },
              { name: 'Retirer un palier', value: 'remove' }
            )
        )
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom du palier (ex: Éclat)'))
        .addIntegerOption((opt) => opt.setName('score_min').setDescription('Score minimum requis').setMinValue(0))
        .addStringOption((opt) => opt.setName('couleur_hex').setDescription('Code couleur Hex (ex: #3B82F6)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('legacy')
        .setDescription('Définir le salon de publication des hommages de départ des membres')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Le salon des hommages')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('legacy-criteria')
        .setDescription('Ajuster les critères d éligibilité d hommage au départ')
        .addIntegerOption((opt) => opt.setName('anciennete_jours').setDescription('Ancienneté min en jours (défaut: 90)').setMinValue(1))
        .addIntegerOption((opt) => opt.setName('niveau_min').setDescription('Niveau d XP min (défaut: 10)').setMinValue(1))
        .addIntegerOption((opt) => opt.setName('invites_min').setDescription('Nombre d invites min (défaut: 5)').setMinValue(1))
    )
    .addSubcommand((sub) =>
      sub
        .setName('pulse-alert')
        .setDescription('Configurer les alertes automatiques d activité Pulse pour ce serveur')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon où envoyer les alertes Pulse')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('seuil_bas')
            .setDescription('Seuil bas : alerte si msgs/h < cette valeur (0 = désactivé)')
            .setMinValue(0)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('seuil_haut')
            .setDescription('Seuil haut : alerte si msgs/h > cette valeur (0 = désactivé)')
            .setMinValue(0)
            .setRequired(false)
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

    if (subcommand === 'forge-visibility') {
      const mode = interaction.options.getString('mode', true) as 'discovered' | 'all';
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { forgeVisibility: mode },
      });
      await GuildConfigService.invalidateGuildConfig(interaction.guild.id);
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Visibilité de la Forge Mise à Jour',
            `Le mode d affichage des recettes de la forge a été réglé sur : **${mode === 'discovered' ? 'Découvertes (1+ composant requis)' : 'Publiques (Toutes les recettes visibles)'}**.`
          ),
        ],
      });
      return;
    }

    if (subcommand === 'aura') {
      const active = interaction.options.getBoolean('actif', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { auraEnabled: active },
      });
      await GuildConfigService.invalidateGuildConfig(interaction.guild.id);
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Module Aura',
            `Le système d endorsement d Aura est désormais : **${active ? 'Activé' : 'Désactivé'}**.`
          ),
        ],
      });
      return;
    }

    if (subcommand === 'aura-qualities') {
      const action = interaction.options.getString('action', true);
      const name = interaction.options.getString('nom')?.trim();

      if (action === 'list') {
        const qualities = await AuraService.getQualities(interaction.guild.id);
        const embed = EmbedService.gold(
          `✨ Qualités d Aura — ${interaction.guild.name}`,
          `Qualités d endorsement disponibles sur ce serveur (${qualities.length}) :\n\n` +
            qualities.map((q) => `• **${q}**`).join('\n')
        );
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (action === 'add') {
        if (!name) {
          await interaction.reply({
            embeds: [EmbedService.error('Paramètre Manquant', 'Veuillez spécifier le nom de la qualité à ajouter.')],
            ephemeral: true,
          });
          return;
        }

        await prisma.auraQuality.upsert({
          where: { guildId_name: { guildId: interaction.guild.id, name } },
          create: { guildId: interaction.guild.id, name },
          update: {},
        });

        await interaction.reply({
          embeds: [EmbedService.success('Qualité Ajoutée', `La qualité **${name}** a été ajoutée au système d Aura.`)],
        });
        return;
      }

      if (action === 'remove') {
        if (!name) {
          await interaction.reply({
            embeds: [EmbedService.error('Paramètre Manquant', 'Veuillez spécifier le nom de la qualité à retirer.')],
            ephemeral: true,
          });
          return;
        }

        const existing = await prisma.auraQuality.findUnique({
          where: { guildId_name: { guildId: interaction.guild.id, name } },
        });

        if (!existing) {
          await interaction.reply({
            embeds: [EmbedService.error('Qualité Introuvable', `La qualité \`${name}\` n existe pas.`)],
            ephemeral: true,
          });
          return;
        }

        await prisma.auraQuality.delete({ where: { id: existing.id } });

        await interaction.reply({
          embeds: [EmbedService.success('Qualité Retirée', `La qualité **${name}** a été retirée du serveur.`)],
        });
        return;
      }
    }

    if (subcommand === 'aura-tiers') {
      const action = interaction.options.getString('action', true);
      const name = interaction.options.getString('nom')?.trim();
      const minScore = interaction.options.getInteger('score_min');
      const colorHex = interaction.options.getString('couleur_hex')?.trim();

      if (action === 'list') {
        const tiers = await AuraService.getTiers(interaction.guild.id);
        const embed = EmbedService.gold(
          `🏅 Paliers d Aura — ${interaction.guild.name}`,
          'Paliers de réputation et rôles dynamiques associés :'
        );

        for (const t of tiers) {
          embed.addFields({
            name: `🏅 ${t.name} (Seuil: ${t.minScore} pts)`,
            value: `• **Couleur Hex** : \`${t.colorHex}\`\n• **Rôle Discord** : ${t.roleId ? `<@&${t.roleId}>` : '`Généré automatiquement lors du 1er franchissement`'}`,
          });
        }

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (action === 'add') {
        if (!name || minScore === null || minScore === undefined) {
          await interaction.reply({
            embeds: [EmbedService.error('Paramètres Manquants', 'Veuillez spécifier le nom du palier et le score minimum requis.')],
            ephemeral: true,
          });
          return;
        }

        const hex = colorHex && /^#[0-9A-F]{6}$/i.test(colorHex) ? colorHex : '#3B82F6';

        await prisma.auraTier.upsert({
          where: { guildId_name: { guildId: interaction.guild.id, name } },
          create: {
            guildId: interaction.guild.id,
            name,
            minScore,
            colorHex: hex,
          },
          update: {
            minScore,
            colorHex: hex,
          },
        });

        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Palier d Aura Configuré',
              `Le palier **${name}** (\`${minScore} pts\`) a été enregistré avec la couleur \`${hex}\`.`
            ),
          ],
        });
        return;
      }

      if (action === 'remove') {
        if (!name) {
          await interaction.reply({
            embeds: [EmbedService.error('Paramètre Manquant', 'Veuillez spécifier le nom du palier à retirer.')],
            ephemeral: true,
          });
          return;
        }

        const existing = await prisma.auraTier.findUnique({
          where: { guildId_name: { guildId: interaction.guild.id, name } },
        });

        if (!existing) {
          await interaction.reply({
            embeds: [EmbedService.error('Palier Introuvable', `Le palier \`${name}\` n existe pas.`)],
            ephemeral: true,
          });
          return;
        }

        await prisma.auraTier.delete({ where: { id: existing.id } });

        await interaction.reply({
          embeds: [EmbedService.success('Palier Retiré', `Le palier **${name}** a été supprimé.`)],
        });
        return;
      }
    }

    if (subcommand === 'legacy') {
      const channel = interaction.options.getChannel('salon', true);
      await LegacyService.updateSettings(interaction.guild.id, {
        channelId: channel.id,
      });
      await interaction.reply({
        embeds: [EmbedService.success('Salon des Hommages Configuré', `Les hommages de départ seront désormais publiés dans ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'legacy-criteria') {
      const tenure = interaction.options.getInteger('anciennete_jours');
      const level = interaction.options.getInteger('niveau_min');
      const invites = interaction.options.getInteger('invites_min');

      const current = await LegacyService.getSettings(interaction.guild.id);

      const updated = await LegacyService.updateSettings(interaction.guild.id, {
        minTenureDays: tenure ?? current.minTenureDays,
        minLevel: level !== null ? level : current.minLevel,
        minInvites: invites !== null ? invites : current.minInvites,
      });

      const embed = EmbedService.success(
        '🕊️ Critères Legacy Mis à Jour',
        'Les seuils d éligibilité aux hommages de départ ont été configurés :'
      ).addFields(
        { name: '⏳ Ancienneté Minimum', value: `\`${updated.minTenureDays} jours\``, inline: true },
        { name: '⭐ Niveau XP Minimum', value: updated.minLevel !== null ? `\`Niveau ${updated.minLevel}\`` : '`Désactivé`', inline: true },
        { name: '✉️ Invitations Minimum', value: updated.minInvites !== null ? `\`${updated.minInvites} membres\`` : '`Désactivé`', inline: true }
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'pulse-alert') {
      const channel = interaction.options.getChannel('salon', true);
      const seuilBas = interaction.options.getInteger('seuil_bas');
      const seuilHaut = interaction.options.getInteger('seuil_haut');

      const low = seuilBas !== null && seuilBas > 0 ? seuilBas : null;
      const high = seuilHaut !== null && seuilHaut > 0 ? seuilHaut : null;

      await PulseService.updateAlertSettings(interaction.guild.id, channel.id, low, high);

      const embed = EmbedService.success(
        '💓 Alertes Pulse Configurées',
        `Les alertes d'activité seront envoyées dans ${channel}.`
      ).addFields(
        {
          name: '💤 Seuil Bas (activité trop faible)',
          value: low !== null ? `\`< ${low} msgs/h\`` : '`Désactivé`',
          inline: true,
        },
        {
          name: '💓 Seuil Haut (activité trop élevée)',
          value: high !== null ? `\`> ${high} msgs/h\`` : '`Désactivé`',
          inline: true,
        }
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;

