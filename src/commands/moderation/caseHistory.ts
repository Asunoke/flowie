import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ModerationService } from '../../services/moderationService.js';
import { config } from '../../config/index.js';

const PAGE_SIZE = 10;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('case-history')
    .setDescription('Lister tous les dossiers de modération d\'un membre sur le serveur')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre concerné').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const cases = await ModerationService.getMemberCases(interaction.guild.id, targetUser.id);

    if (cases.length === 0) {
      await interaction.reply({
        embeds: [
          EmbedService.create(
            'ℹ️ Aucun dossier de modération',
            `Le membre **${targetUser.tag}** n'a aucun dossier de modération enregistré sur ce serveur.`,
            config.bot.colors.info
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const typeLabels: Record<string, string> = {
      WARN: '⚠️ WARN',
      MUTE: '🔇 MUTE',
      UNMUTE: '🔊 UNMUTE',
      KICK: '🚪 KICK',
      BAN: '🚨 BAN',
      UNBAN: '🟢 UNBAN',
      SOFTBAN: '🧹 SOFTBAN',
      SLOWMODE: '⏱️ SLOWMODE',
      NICKNAME: '🏷️ NICKNAME',
      PURGE_USER: '🗑️ PURGE',
    };

    const totalPages = Math.ceil(cases.length / PAGE_SIZE);

    const buildPage = (page: number): EmbedBuilder => {
      const start = page * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, cases.length);
      const pageCases = cases.slice(start, end);

      const lines = pageCases.map((c: any) => {
        const typeStr = typeLabels[c.type] || c.type;
        const timeStr = `<t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`;
        return `• **\`#${c.id.slice(0, 8)}\`** | **${typeStr}** par <@${c.moderatorId}> (${timeStr})\n  └ *Raison :* ${c.reason}`;
      });

      const embed = EmbedService.create(
        `📋 Historique de modération — ${targetUser.tag}`,
        lines.join('\n\n'),
        config.bot.colors.primary
      ).setThumbnail(targetUser.displayAvatarURL({ size: 128 }));

      if (totalPages > 1) {
        embed.setFooter({
          text: `Page ${page + 1}/${totalPages} • ${cases.length} dossier(s) au total • ${config.bot.footer.text}`,
        });
      } else {
        embed.setFooter({
          text: `${cases.length} dossier(s) au total • ${config.bot.footer.text}`,
        });
      }

      return embed;
    };

    if (totalPages === 1) {
      await interaction.reply({ embeds: [buildPage(0)] });
      return;
    }

    let currentPage = 0;
    const embed = buildPage(currentPage);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('case_hist_prev')
        .setLabel('◀ Précédent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('case_hist_next')
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1)
    );

    const reply = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (btnInteraction) => {
      if (btnInteraction.customId === 'case_hist_prev') {
        currentPage = Math.max(0, currentPage - 1);
      } else if (btnInteraction.customId === 'case_hist_next') {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
      }

      const newEmbed = buildPage(currentPage);
      const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('case_hist_prev')
          .setLabel('◀ Précédent')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('case_hist_next')
          .setLabel('Suivant ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      );

      await btnInteraction.update({ embeds: [newEmbed], components: [newRow] });
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('case_hist_prev')
          .setLabel('◀ Précédent')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('case_hist_next')
          .setLabel('Suivant ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      await reply.edit({ components: [disabledRow] }).catch(() => null);
    });
  },
};

export default command;
