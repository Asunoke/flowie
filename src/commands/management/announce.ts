import { SlashCommandBuilder, PermissionFlagsBits, TextChannel, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Publier une annonce officielle formatée en embed')
    .addChannelOption((opt) => opt.setName('salon').setDescription('Salon de destination').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((opt) => opt.setName('titre').setDescription('Titre de l annonce').setRequired(true))
    .addStringOption((opt) => opt.setName('message').setDescription('Contenu de l annonce').setRequired(true))
    .addBooleanOption((opt) => opt.setName('mention_everyone').setDescription('Mentionner @everyone ?'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const channel = interaction.options.getChannel('salon', true) as TextChannel;
    const title = interaction.options.getString('titre', true);
    const message = interaction.options.getString('message', true);
    const mentionEveryone = interaction.options.getBoolean('mention_everyone') || false;

    const embed = EmbedService.gold(`📢 ${title}`, message)
      .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined });

    await channel.send({
      content: mentionEveryone ? '@everyone' : undefined,
      embeds: [embed],
    });

    await interaction.reply({
      embeds: [EmbedService.success('Annonce publiée', `L annonce a été envoyée avec succès dans ${channel}.`)],
      ephemeral: true,
    });
  },
};

export default command;
