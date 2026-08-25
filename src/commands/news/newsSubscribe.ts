import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('news-subscribe')
    .setDescription('S abonner à un flux RSS/API d actualité à poster automatiquement dans un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Salon textuel récepteur')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('flux').setDescription('Sujet ou URL directe du flux RSS').setRequired(true)
    ),
  category: 'news',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const channel = interaction.options.getChannel('salon', true);
    const feed = interaction.options.getString('flux', true);

    await prisma.newsSubscription.upsert({
      where: {
        guildId_channelId_feedUrl: {
          guildId: interaction.guild.id,
          channelId: channel.id,
          feedUrl: feed,
        },
      },
      create: {
        guildId: interaction.guild.id,
        channelId: channel.id,
        feedUrl: feed,
      },
      update: {},
    });

    await interaction.reply({
      embeds: [
        EmbedService.success(
          'Abonnement Actu configuré',
          `Le salon ${channel} recevra désormais automatiquement les nouveaux articles du flux : \`${feed}\` (vérification toutes les 15 min).`
        ),
      ],
    });
  },
};

export default command;
