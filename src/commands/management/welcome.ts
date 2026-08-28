import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
  AttachmentBuilder,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';
import { WelcomeCardService } from '../../services/welcomeCardService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configuration complète du système de Bienvenue (Welcome) et de Départ (Leave)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Afficher la configuration globale Welcome & Leave')
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Tester et simuler un message d\'arrivée (welcome) ou de départ (leave)')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Type de message à simuler')
            .setRequired(false)
            .addChoices(
              { name: 'Bienvenue (Welcome)', value: 'welcome' },
              { name: 'Départ (Leave)', value: 'leave' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('test-welcome')
        .setDescription('Simuler et envoyer le message de bienvenue pour l\'administrateur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('test-leave')
        .setDescription('Simuler et envoyer le message de départ pour l\'administrateur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('salon')
        .setDescription('Définir le salon d\'envoi des cartes et messages de bienvenue')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon de bienvenue')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('salon-leave')
        .setDescription('Définir le salon d\'envoi des cartes et messages de départ')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon de départ')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('activer-welcome')
        .setDescription('Activer ou désactiver les messages de bienvenue')
        .addBooleanOption((opt) =>
          opt.setName('actif').setDescription('Activer le module Welcome').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('activer-leave')
        .setDescription('Activer ou désactiver les messages de départ')
        .addBooleanOption((opt) =>
          opt.setName('actif').setDescription('Activer le module Leave').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('message')
        .setDescription('Personnaliser le message de bienvenue')
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Message. Variables: {user}, {server}, {membercount}')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('message-leave')
        .setDescription('Personnaliser le message de départ')
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Message. Variables: {user}, {server}, {membercount}')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('autorole')
        .setDescription('Définir le rôle attribué aux nouveaux arrivants')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle attribué').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('image-welcome')
        .setDescription('Définir l\'URL d\'une image de fond personnalisée pour les cartes de bienvenue')
        .addStringOption((opt) =>
          opt.setName('url').setDescription('URL directe de l\'image (PNG/JPG)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('image-leave')
        .setDescription('Définir l\'URL d\'une image de fond personnalisée pour les cartes de départ')
        .addStringOption((opt) =>
          opt.setName('url').setDescription('URL directe de l\'image (PNG/JPG)').setRequired(true)
        )
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    let guildConfig = await prisma.guild.findUnique({
      where: { id: interaction.guild.id },
    });

    if (!guildConfig) {
      guildConfig = await prisma.guild.create({
        data: { id: interaction.guild.id },
      });
    }

    const subcommand = interaction.options.getSubcommand(false) || 'voir';

    if (subcommand === 'test' || subcommand === 'test-welcome' || subcommand === 'test-leave') {
      await interaction.deferReply({ ephemeral: true });

      const testType =
        subcommand === 'test-leave'
          ? 'leave'
          : subcommand === 'test-welcome'
          ? 'welcome'
          : interaction.options.getString('type') || 'welcome';

      const member = (interaction.member as GuildMember) || null;
      if (!member) {
        await interaction.editReply({
          embeds: [EmbedService.error('Erreur', 'Impossible de récupérer votre profil de membre.')],
        });
        return;
      }

      if (testType === 'welcome') {
        let targetChannel = guildConfig.welcomeChannelId
          ? interaction.guild.channels.cache.get(guildConfig.welcomeChannelId)
          : null;

        if (!targetChannel || !targetChannel.isTextBased()) {
          targetChannel = interaction.channel;
        }

        if (!targetChannel || !targetChannel.isTextBased()) {
          await interaction.editReply({
            embeds: [
              EmbedService.error(
                'Erreur Salon',
                'Aucun salon textuel valide trouvé pour envoyer le message de test.'
              ),
            ],
          });
          return;
        }

        const rawMsg =
          guildConfig.welcomeMessage ||
          'Bienvenue {user} sur {server} ! Nous sommes désormais {membercount} membres.';
        const formattedMsg = rawMsg
          .replace(/{user}/g, `${member}`)
          .replace(/{server}/g, interaction.guild.name)
          .replace(/{membercount}/g, interaction.guild.memberCount.toString());

        const cardBuffer = await WelcomeCardService.generateWelcomeCard(
          member,
          guildConfig.welcomeBgUrl
        );
        const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome-card.png' });

        const embed = EmbedService.create('🎉 [TEST] Nouveau Membre !', formattedMsg).setImage(
          'attachment://welcome-card.png'
        );

        await (targetChannel as TextChannel).send({
          content: `${member}`,
          embeds: [embed],
          files: [attachment],
        });

        await interaction.editReply({
          embeds: [
            EmbedService.success(
              'Test de Bienvenue envoyé 🧪',
              `Le message et la carte de bienvenue de test ont été envoyés dans ${targetChannel}.`
            ),
          ],
        });
        return;
      } else {
        let targetChannel = guildConfig.leaveChannelId
          ? interaction.guild.channels.cache.get(guildConfig.leaveChannelId)
          : null;

        if (!targetChannel || !targetChannel.isTextBased()) {
          targetChannel = interaction.channel;
        }

        if (!targetChannel || !targetChannel.isTextBased()) {
          await interaction.editReply({
            embeds: [
              EmbedService.error(
                'Erreur Salon',
                'Aucun salon textuel valide trouvé pour envoyer le message de test.'
              ),
            ],
          });
          return;
        }

        const rawMsg =
          guildConfig.leaveMessage ||
          '{user} a quitté {server}. Nous sommes désormais {membercount} membres.';
        const tagOrName = member.user ? member.user.tag : interaction.user.tag;
        const formattedMsg = rawMsg
          .replace(/{user}/g, `**${tagOrName}**`)
          .replace(/{server}/g, interaction.guild.name)
          .replace(/{membercount}/g, interaction.guild.memberCount.toString());

        const cardBuffer = await WelcomeCardService.generateLeaveCard(
          member,
          guildConfig.leaveBgUrl
        );
        const attachment = new AttachmentBuilder(cardBuffer, { name: 'leave-card.png' });

        const embed = EmbedService.create(
          '👋 [TEST] Départ d\'un membre',
          formattedMsg,
          config.bot.colors.error
        ).setImage('attachment://leave-card.png');

        await (targetChannel as TextChannel).send({
          embeds: [embed],
          files: [attachment],
        });

        await interaction.editReply({
          embeds: [
            EmbedService.success(
              'Test de Départ envoyé 🧪',
              `Le message et la carte de départ de test ont été envoyés dans ${targetChannel}.`
            ),
          ],
        });
        return;
      }
    }

    if (subcommand === 'voir') {
      const embed = EmbedService.gold(
        `🎉 Configuration Welcome & Leave — ${interaction.guild.name}`,
        'Aperçu global du système d\'accueil, de départ et d\'auto-rôle.'
      ).addFields(
        {
          name: '👋 Module Welcome (Arrivée)',
          value: guildConfig.welcomeEnabled ? '🟢 `Activé`' : '🔴 `Désactivé`',
          inline: true,
        },
        {
          name: '👋 Salon Bienvenue',
          value: guildConfig.welcomeChannelId ? `<#${guildConfig.welcomeChannelId}>` : '`Non configuré`',
          inline: true,
        },
        {
          name: '🖼️ Fond Welcome',
          value: guildConfig.welcomeBgUrl ? `[Lien Image](${guildConfig.welcomeBgUrl})` : '`Par défaut (Gradient)`',
          inline: true,
        },
        {
          name: '💬 Message Welcome',
          value: `> ${guildConfig.welcomeMessage || '`Par défaut`'}`,
          inline: false,
        },
        {
          name: '🚪 Module Leave (Départ)',
          value: guildConfig.leaveEnabled ? '🟢 `Activé`' : '🔴 `Désactivé`',
          inline: true,
        },
        {
          name: '🚪 Salon Départ',
          value: guildConfig.leaveChannelId ? `<#${guildConfig.leaveChannelId}>` : '`Non configuré`',
          inline: true,
        },
        {
          name: '🖼️ Fond Leave',
          value: guildConfig.leaveBgUrl ? `[Lien Image](${guildConfig.leaveBgUrl})` : '`Par défaut (Gradient)`',
          inline: true,
        },
        {
          name: '💬 Message Leave',
          value: `> ${guildConfig.leaveMessage || '`Par défaut`'}`,
          inline: false,
        },
        {
          name: '🎭 Auto-Rôle',
          value: guildConfig.autoRoleId ? `<@&${guildConfig.autoRoleId}>` : '`Non configuré`',
          inline: true,
        }
      ).setFooter({ text: 'Variables : {user}, {server}, {membercount} • Testez avec /welcome test' });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'salon') {
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

    if (subcommand === 'salon-leave') {
      const channel = interaction.options.getChannel('salon', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { leaveChannelId: channel.id },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Configuration mise à jour', `Le salon de départ a été défini sur ${channel}.`)],
      });
      return;
    }

    if (subcommand === 'activer-welcome') {
      const active = interaction.options.getBoolean('actif', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { welcomeEnabled: active },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Module Welcome', `Module de bienvenue : ${active ? '**Activé** 🟢' : '**Désactivé** 🔴'}.`)],
      });
      return;
    }

    if (subcommand === 'activer-leave') {
      const active = interaction.options.getBoolean('actif', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { leaveEnabled: active },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Module Leave', `Module de départ : ${active ? '**Activé** 🟢' : '**Désactivé** 🔴'}.`)],
      });
      return;
    }

    if (subcommand === 'message') {
      const msg = interaction.options.getString('message', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { welcomeMessage: msg },
      });
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Message de bienvenue mis à jour',
            `**Nouveau modèle** :\n> ${msg}\n\n*Variables prises en charge :* \`{user}\`, \`{server}\`, \`{membercount}\``
          ),
        ],
      });
      return;
    }

    if (subcommand === 'message-leave') {
      const msg = interaction.options.getString('message', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { leaveMessage: msg },
      });
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Message de départ mis à jour',
            `**Nouveau modèle** :\n> ${msg}\n\n*Variables prises en charge :* \`{user}\`, \`{server}\`, \`{membercount}\``
          ),
        ],
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
        embeds: [EmbedService.success('Auto-Rôle mis à jour', `Le rôle attribué aux nouveaux arrivants est désormais ${role}.`)],
      });
      return;
    }

    if (subcommand === 'image-welcome') {
      const url = interaction.options.getString('url', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { welcomeBgUrl: url },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Fond Welcome mis à jour', `Image de fond pour les cartes de bienvenue définie sur :\n${url}`)],
      });
      return;
    }

    if (subcommand === 'image-leave') {
      const url = interaction.options.getString('url', true);
      await prisma.guild.update({
        where: { id: interaction.guild.id },
        data: { leaveBgUrl: url },
      });
      await interaction.reply({
        embeds: [EmbedService.success('Fond Leave mis à jour', `Image de fond pour les cartes de départ définie sur :\n${url}`)],
      });
      return;
    }
  },
};

export default command;

