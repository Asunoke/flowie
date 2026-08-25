import { SlashCommandBuilder, PermissionFlagsBits, TextChannel, ChannelType } from 'discord.js';
import { Command } from '../../types/command.js';
import { GiveawayService } from '../../services/giveawayService.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Gestion des concours et tirages au sort')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Lancer un nouveau concours')
        .addStringOption((opt) => opt.setName('prix').setDescription('Le prix à gagner').setRequired(true))
        .addIntegerOption((opt) => opt.setName('duree').setDescription('Durée en minutes').setMinValue(1).setRequired(true))
        .addIntegerOption((opt) => opt.setName('gagnants').setDescription('Nombre de gagnants (défaut: 1)').setMinValue(1).setMaxValue(10))
        .addRoleOption((opt) => opt.setName('role_requis').setDescription('Rôle requis pour participer'))
        .addChannelOption((opt) => opt.setName('salon').setDescription('Salon cible').addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((sub) =>
      sub
        .setName('reroll')
        .setDescription('Relancer le tirage au sort pour désigner de nouveaux gagnants')
        .addStringOption((opt) => opt.setName('giveaway_id').setDescription('ID du concours').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Terminer prématurément un concours en cours')
        .addStringOption((opt) => opt.setName('giveaway_id').setDescription('ID du concours').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Afficher la liste des concours actifs')),
  category: 'giveaways',
  userPermissions: [PermissionFlagsBits.ManageEvents],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      const prize = interaction.options.getString('prix', true);
      const durationMinutes = interaction.options.getInteger('duree', true);
      const winnersCount = interaction.options.getInteger('gagnants') || 1;
      const requiredRole = interaction.options.getRole('role_requis');
      const targetChannel = (interaction.options.getChannel('salon') || interaction.channel) as TextChannel;

      if (!targetChannel || !targetChannel.isTextBased()) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Veuillez sélectionner un salon textuel valide.')],
          ephemeral: true,
        });
        return;
      }

      const giveaway = await GiveawayService.createGiveaway(
        interaction.client,
        interaction.guild.id,
        targetChannel.id,
        interaction.user.id,
        prize,
        winnersCount,
        durationMinutes,
        requiredRole ? requiredRole.id : undefined
      );

      if (!giveaway) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Échec de la création du concours.')],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Concours Lancé !',
            `Le concours **${prize}** a été publié dans ${targetChannel} !\n**ID du concours** : \`${giveaway.id}\``
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'end') {
      const giveawayIdInput = interaction.options.getString('giveaway_id', true);

      const giveaway = await prisma.giveaway.findFirst({
        where: {
          guildId: interaction.guild.id,
          OR: [{ id: giveawayIdInput }, { messageId: giveawayIdInput }],
        },
      });

      if (!giveaway || giveaway.ended) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', `Aucun concours actif trouvé pour l ID \`${giveawayIdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      await GiveawayService.endGiveaway(interaction.client, giveaway.id);

      await interaction.reply({
        embeds: [EmbedService.success('Concours terminé', `Le concours \`${giveaway.id}\` a été terminé prématurément.`)],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'reroll') {
      const giveawayIdInput = interaction.options.getString('giveaway_id', true);

      const giveaway = await prisma.giveaway.findFirst({
        where: {
          guildId: interaction.guild.id,
          OR: [{ id: giveawayIdInput }, { messageId: giveawayIdInput }],
        },
      });

      if (!giveaway || !giveaway.ended) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', `Aucun concours terminé trouvé pour l ID \`${giveawayIdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      const winners = await GiveawayService.rerollGiveaway(interaction.client, giveaway.id);

      if (!winners || winners.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.warning('Tirage impossible', 'Aucun participant éligible à désigner.')],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          embeds: [EmbedService.success('Nouveau tirage effectué', `Nouveau(x) gagnant(s) désigné(s) : ${winners.map((w) => `<@${w}>`).join(', ')}`)],
          ephemeral: true,
        });
      }
      return;
    }

    if (subcommand === 'list') {
      const activeGiveaways = await prisma.giveaway.findMany({
        where: { guildId: interaction.guild.id, ended: false },
      });

      if (activeGiveaways.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.warning('Aucun concours actif', 'Il n y a aucun concours en cours sur ce serveur.')],
        });
        return;
      }

      const embed = EmbedService.gold(
        `🎉 Concours Actifs — ${interaction.guild.name}`,
        `Liste des concours en cours (${activeGiveaways.length})`
      );

      activeGiveaways.forEach((gw: { id: string; prize: string; channelId: string; endsAt: Date; winnersCount: number }) => {
        const timestamp = Math.floor(new Date(gw.endsAt).getTime() / 1000);
        embed.addFields({
          name: `🎁 ${gw.prize} (ID: \`${gw.id.slice(0, 8)}\`)`,
          value: `**Salon** : <#${gw.channelId}>\n**Fin** : <t:${timestamp}:R>\n**Gagnants** : \`${gw.winnersCount}\``,
        });
      });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
