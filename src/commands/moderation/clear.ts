import { SlashCommandBuilder, PermissionFlagsBits, TextChannel } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Suppression en masse de messages dans le salon')
    .addIntegerOption((opt) => opt.setName('nombre').setDescription('Nombre de messages à supprimer (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((opt) => opt.setName('auteur').setDescription('Filtrer par auteur spécifique'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;

    const amount = interaction.options.getInteger('nombre', true);
    const filterUser = interaction.options.getUser('auteur');

    const fetchedMessages = await interaction.channel.messages.fetch({ limit: amount });

    let messagesToDelete = Array.from(fetchedMessages.values());
    if (filterUser) {
      messagesToDelete = messagesToDelete.filter((msg) => msg.author.id === filterUser.id);
    }

    if (messagesToDelete.length === 0) {
      await interaction.reply({
        embeds: [EmbedService.warning('Aucun message', 'Aucun message ne correspond aux critères de suppression.')],
        ephemeral: true,
      });
      return;
    }

    const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);

    const embed = EmbedService.success(
      'Nettoyage effectué',
      `\`${deleted.size}\` message(s) supprimé(s) avec succès${filterUser ? ` de ${filterUser.tag}` : ''}.`
    );

    await interaction.reply({ embeds: [embed], ephemeral: true });

    const logEmbed = EmbedService.gold('🧹 Nettoyage de Salon', `**Salon** : <#${interaction.channel.id}>\n**Messages supprimés** : \`${deleted.size}\``)
      .addFields({ name: 'Modérateur', value: `${interaction.user.tag}` });
    await ModerationService.sendModLog(interaction.guild.id, logEmbed, interaction.member);
  },
};

export default command;
