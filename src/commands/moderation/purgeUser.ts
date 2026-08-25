import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('purge-user')
    .setDescription('Supprimer uniquement les messages d\'un membre précis dans les derniers messages du salon')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre dont supprimer les messages').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('nombre')
        .setDescription('Nombre de messages à inspecter/supprimer (1 à 100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon concerné (défaut: salon actuel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const count = interaction.options.getInteger('nombre', true);
    const targetChannelOption = interaction.options.getChannel('salon');
    const targetChannel = (targetChannelOption || interaction.channel) as TextChannel;

    if (!targetChannel || !(targetChannel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Le salon spécifié n\'est pas un salon textuel valide.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch messages
    const fetched = await targetChannel.messages.fetch({ limit: 100 }).catch(() => null);

    if (!fetched || fetched.size === 0) {
      await interaction.editReply({
        embeds: [EmbedService.warning('Aucun message', 'Aucun message n\'a été trouvé dans ce salon.')],
      });
      return;
    }

    const now = Date.now();
    // Filter messages by author
    const userMessages = Array.from(fetched.values())
      .filter((msg) => msg.author.id === targetUser.id)
      .slice(0, count);

    if (userMessages.length === 0) {
      await interaction.editReply({
        embeds: [EmbedService.warning('Aucun message trouvé', `Aucun message récent de ${targetUser.tag} n'a été trouvé dans ${targetChannel}.`)],
      });
      return;
    }

    // Separate messages <= 14 days old and > 14 days old
    const deletable = userMessages.filter((msg) => now - msg.createdTimestamp < FOURTEEN_DAYS_MS);
    const tooOldCount = userMessages.length - deletable.length;

    let deletedCount = 0;
    if (deletable.length > 0) {
      const deletedCollection = await targetChannel.bulkDelete(deletable, true).catch(() => null);
      deletedCount = deletedCollection ? deletedCollection.size : 0;
    }

    // Create ModerationCase & log
    await ModerationService.createCase(
      interaction.guild.id,
      targetUser.id,
      interaction.user.id,
      'PURGE_USER',
      `Purge de ${deletedCount} message(s) de ${targetUser.tag} dans #${targetChannel.name}`,
      interaction.guild
    );

    let desc = `**${deletedCount} message(s)** de ${targetUser} ont été supprimés dans ${targetChannel}.`;
    if (tooOldCount > 0) {
      desc += `\n\n⚠️ **Note** : **${tooOldCount} message(s)** datant de plus de 14 jours n'ont pas pu être supprimés en raison des limitations de l'API Discord.`;
    }

    const embed = EmbedService.success('Purge utilisateur effectuée', desc);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
