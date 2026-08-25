import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('news-unsubscribe')
    .setDescription('Se désabonner d un flux d actualité configuré sur un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Salon textuel récepteur')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('flux').setDescription('Sujet ou URL du flux à désabonner').setRequired(true)
    ),
  category: 'news',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const channel = interaction.options.getChannel('salon', true);
    const feed = interaction.options.getString('flux', true);

    const res = await prisma.newsSubscription.deleteMany({
      where: {
        guildId: interaction.guild.id,
        channelId: channel.id,
        feedUrl: feed,
      },
    });

    if (res.count === 0) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Abonnement non trouvé',
            `Aucun abonnement correspondant au flux \`${feed}\` n'a été trouvé pour le salon ${channel}.`
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        EmbedService.success(
          'Désabonnement effectué',
          `Le salon ${channel} ne recevra plus les mises à jour du flux : \`${feed}\`.`
        ),
      ],
    });
  },
};

export default command;
