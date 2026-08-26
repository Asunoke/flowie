import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { StreamNotifyService } from '../../services/streamNotifyService.js';
import { YouTubeService } from '../../services/youtubeService.js';
import { config } from '../../config/index.js';

const notifyYoutubeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('notify-youtube')
    .setDescription('Gérer les notifications de nouvelles vidéos/lives YouTube')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ajouter une chaîne YouTube à surveiller')
        .addStringOption((opt) =>
          opt
            .setName('chaîne')
            .setDescription('Nom, @handle ou ID de chaîne YouTube (ex: @JoueurDuGrenier)')
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
        .setDescription('Supprimer la surveillance d\'une chaîne YouTube')
        .addStringOption((opt) =>
          opt
            .setName('chaîne')
            .setDescription('Nom ou ID de la chaîne YouTube à retirer')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Lister les chaînes YouTube actuellement surveillées sur ce serveur')
    ),
  category: 'notify',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const channelInput = interaction.options.getString('chaîne', true);
      const targetChannel = interaction.options.getChannel('salon', true);
      const customMessage = interaction.options.getString('message');

      await interaction.deferReply();

      // Resolve YouTube Channel ID and details
      const youtubeChannel = await YouTubeService.resolveChannel(channelInput);
      if (!youtubeChannel) {
        await interaction.editReply({
          embeds: [
            EmbedService.error(
              'Chaîne YouTube introuvable',
              `Impossible de trouver ou résoudre la chaîne YouTube **${channelInput}**.\n` +
                'Vérifiez le nom ou utilisez l\'ID direct (ex: `UC...`).'
            ),
          ],
        });
        return;
      }

      try {
        await StreamNotifyService.addSubscription(
          interaction.guild.id,
          targetChannel.id,
          'youtube',
          youtubeChannel.handle || channelInput,
          youtubeChannel.channelId,
          customMessage || undefined
        );

        const embed = EmbedService.success(
          'Abonnement YouTube configuré !',
          `Le bot annoncera désormais les nouvelles vidéos de **${youtubeChannel.title}** dans <#${targetChannel.id}>.`
        ).addFields(
          { name: '📺 Chaîne', value: `\`${youtubeChannel.title}\` (\`${youtubeChannel.channelId}\`)`, inline: true },
          { name: '📢 Salon', value: `<#${targetChannel.id}>`, inline: true },
          {
            name: '💬 Message personnalisé',
            value: customMessage ? `\`${customMessage}\`` : '*Par défaut*',
            inline: false,
          }
        );

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({
          embeds: [EmbedService.error('Erreur de configuration', err.message || 'Une erreur est survenue.')],
        });
      }
    } else if (subcommand === 'remove') {
      const channelInput = interaction.options.getString('chaîne', true);

      const success = await StreamNotifyService.removeSubscription(
        interaction.guild.id,
        'youtube',
        channelInput
      );

      if (success) {
        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Abonnement retiré',
              `La surveillance YouTube pour **${channelInput}** a bien été supprimée.`
            ),
          ],
        });
      } else {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Abonnement non trouvé',
              `Aucun abonnement YouTube actif n'a été trouvé pour **${channelInput}** sur ce serveur.`
            ),
          ],
        });
      }
    } else if (subcommand === 'list') {
      const subs = await StreamNotifyService.listSubscriptions(interaction.guild.id, 'youtube');

      if (subs.length === 0) {
        await interaction.reply({
          embeds: [
            EmbedService.create(
              '🔴 Notifications YouTube — Liste',
              'Aucune chaîne YouTube n\'est surveillée sur ce serveur.\nUtilisez `/notify-youtube add` pour en ajouter une.'
            ),
          ],
        });
        return;
      }

      const description = subs
        .map(
          (
            s: { targetHandle: string; targetId?: string | null; channelId: string; customMessage?: string | null },
            idx: number
          ) =>
            `**${idx + 1}.** \`${s.targetHandle}\` (${s.targetId || 'N/A'}) ➡️ <#${s.channelId}>` +
            (s.customMessage ? `\n> 💬 *"${s.customMessage}"*` : '')
        )
        .join('\n\n');


      const embed = EmbedService.create(
        `🔴 Notifications YouTube — ${interaction.guild.name}`,
        description
      ).setFooter({ text: `${subs.length}/${config.stream.maxSubsPerGuild} abonnements utilisés` });

      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default notifyYoutubeCommand;
