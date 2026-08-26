import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { StreamNotifyService } from '../../services/streamNotifyService.js';
import { TwitchService } from '../../services/twitchService.js';
import { config } from '../../config/index.js';

const notifyTwitchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('notify-twitch')
    .setDescription('Gérer les notifications d\'annonce de live Twitch')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ajouter une chaîne Twitch à surveiller')
        .addStringOption((opt) =>
          opt
            .setName('chaîne')
            .setDescription('Le nom d\'utilisateur Twitch (ex: kameto)')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Le salon Discord où poster l\'annonce')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Message personnalisé ({streamer}, {title}, {game}, {url})')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Supprimer la surveillance d\'une chaîne Twitch')
        .addStringOption((opt) =>
          opt
            .setName('chaîne')
            .setDescription('Le nom d\'utilisateur Twitch à retirer')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Lister les chaînes Twitch actuellement surveillées sur ce serveur')
    ),
  category: 'notify',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const streamerInput = interaction.options.getString('chaîne', true);
      const targetChannel = interaction.options.getChannel('salon', true);
      const customMessage = interaction.options.getString('message');

      await interaction.deferReply();

      // Check if Twitch API credentials are configured
      if (!TwitchService.isConfigured()) {
        await interaction.editReply({
          embeds: [
            EmbedService.warning(
              'Configuration Twitch absente',
              'Le bot n\'a pas de `TWITCH_CLIENT_ID` ou `TWITCH_CLIENT_SECRET` configuré en variable d\'environnement.\n' +
                'Veuillez contacter le propriétaire du bot pour configurer les identifiants Twitch.'
            ),
          ],
        });
        return;
      }

      // Validate Twitch user profile
      const twitchUser = await TwitchService.validateUser(streamerInput);
      if (!twitchUser) {
        await interaction.editReply({
          embeds: [
            EmbedService.error(
              'Chaîne Twitch introuvable',
              `La chaîne Twitch **${streamerInput}** n'existe pas ou la vérification a échoué.`
            ),
          ],
        });
        return;
      }

      try {
        await StreamNotifyService.addSubscription(
          interaction.guild.id,
          targetChannel.id,
          'twitch',
          twitchUser.login,
          twitchUser.id,
          customMessage || undefined
        );

        const embed = EmbedService.success(
          'Abonnement Twitch configuré !',
          `Le bot annoncera désormais les lives de **${twitchUser.displayName}** dans <#${targetChannel.id}>.`
        ).addFields(
          { name: '📺 Streamer', value: `\`${twitchUser.displayName}\` (${twitchUser.login})`, inline: true },
          { name: '📢 Salon', value: `<#${targetChannel.id}>`, inline: true },
          {
            name: '💬 Message personnalisé',
            value: customMessage ? `\`${customMessage}\`` : '*Par défaut*',
            inline: false,
          }
        );

        if (twitchUser.profileImageUrl) {
          embed.setThumbnail(twitchUser.profileImageUrl);
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({
          embeds: [EmbedService.error('Erreur de configuration', err.message || 'Une erreur est survenue.')],
        });
      }
    } else if (subcommand === 'remove') {
      const streamerInput = interaction.options.getString('chaîne', true);

      const success = await StreamNotifyService.removeSubscription(
        interaction.guild.id,
        'twitch',
        streamerInput
      );

      if (success) {
        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Abonnement retiré',
              `La surveillance Twitch pour **${streamerInput}** a bien été supprimée.`
            ),
          ],
        });
      } else {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Abonnement non trouvé',
              `Aucun abonnement Twitch actif n'a été trouvé pour **${streamerInput}** sur ce serveur.`
            ),
          ],
        });
      }
    } else if (subcommand === 'list') {
      const subs = await StreamNotifyService.listSubscriptions(interaction.guild.id, 'twitch');

      if (subs.length === 0) {
        await interaction.reply({
          embeds: [
            EmbedService.create(
              '💜 Notifications Twitch — Liste',
              'Aucune chaîne Twitch n\'est surveillée sur ce serveur.\nUtilisez `/notify-twitch add` pour en ajouter une.'
            ),
          ],
        });
        return;
      }

      const description = subs
        .map(
          (s: { targetHandle: string; channelId: string; customMessage?: string | null }, idx: number) =>
            `**${idx + 1}.** \`${s.targetHandle}\` ➡️ <#${s.channelId}>` +
            (s.customMessage ? `\n> 💬 *"${s.customMessage}"*` : '')
        )
        .join('\n\n');


      const embed = EmbedService.create(
        `💜 Notifications Twitch — ${interaction.guild.name}`,
        description
      ).setFooter({ text: `${subs.length}/${config.stream.maxSubsPerGuild} abonnements utilisés` });

      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default notifyTwitchCommand;
