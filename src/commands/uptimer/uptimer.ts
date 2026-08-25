import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import {
  UptimeService,
  MAX_TRACKED_BOTS,
  STATUS_EMOJI,
  STATUS_LABEL,
} from '../../services/uptimerService.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

/** Time period constants in milliseconds */
const PERIOD_24H = 24 * 60 * 60 * 1000;
const PERIOD_7D = 7 * 24 * 60 * 60 * 1000;
const PERIOD_30D = 30 * 24 * 60 * 60 * 1000;

/** Items per page in the list embed */
const LIST_PAGE_SIZE = 10;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('uptimer')
    .setDescription('Suivre le statut de connexion des bots du serveur')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ajouter un bot à la liste de suivi')
        .addUserOption((opt) =>
          opt
            .setName('bot')
            .setDescription('Le bot à suivre')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Retirer un bot du suivi')
        .addUserOption((opt) =>
          opt
            .setName('bot')
            .setDescription('Le bot à retirer')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lister les bots suivis et leur statut actuel')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Voir le détail d\'un bot suivi')
        .addUserOption((opt) =>
          opt
            .setName('bot')
            .setDescription('Le bot à inspecter')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('alert')
        .setDescription('Configurer une alerte de changement de statut')
        .addUserOption((opt) =>
          opt
            .setName('bot')
            .setDescription('Le bot à surveiller')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Le salon où envoyer les alertes')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('alert-off')
        .setDescription('Désactiver l\'alerte pour un bot')
        .addUserOption((opt) =>
          opt
            .setName('bot')
            .setDescription('Le bot dont désactiver l\'alerte')
            .setRequired(true)
        )
    ),
  category: 'uptimer',
  cooldown: 3,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add':
        return handleAdd(interaction);
      case 'remove':
        return handleRemove(interaction);
      case 'list':
        return handleList(interaction);
      case 'status':
        return handleStatus(interaction);
      case 'alert':
        return handleAlert(interaction);
      case 'alert-off':
        return handleAlertOff(interaction);
    }
  },
};

// ─── Subcommand Handlers ──────────────────────────────────────────────

async function handleAdd(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('bot');

  // Guard: option nulle/undefined
  if (!user) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un bot à tracker.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Guard: l'utilisateur sélectionné n'est pas un bot
  if (!user.bot) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Utilisateur invalide',
          `**${user.tag}** n'est pas un bot. Seuls les comptes bot peuvent être suivis.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await UptimeService.addBot(
    interaction.guild!.id,
    user.id,
    interaction.user.id
  );

  if (!result.success) {
    if (result.reason === 'already_tracked') {
      await interaction.reply({
        embeds: [
          EmbedService.create(
            'ℹ️ Déjà suivi',
            `Le bot **${user.tag}** est déjà dans la liste de suivi.`,
            config.bot.colors.info
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (result.reason === 'limit_reached') {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Limite atteinte',
            `Vous avez atteint la limite de **${MAX_TRACKED_BOTS} bots** suivis sur ce serveur.\nRetirez un bot avec \`/uptimer remove\` avant d'en ajouter un nouveau.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Erreur',
          'Une erreur est survenue lors de l\'ajout. Réessayez plus tard.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Record the initial status if the bot is currently in the guild
  try {
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (member) {
      const presence = member.presence;
      const status = presence?.status || 'offline';
      await UptimeService.recordEvent(interaction.guild!.id, user.id, status as any);
    }
  } catch {
    // Non-blocking: initial status recording failure is not critical
  }

  await interaction.reply({
    embeds: [
      EmbedService.success(
        'Bot ajouté au suivi',
        `Le bot **${user.tag}** est désormais suivi sur ce serveur.\nUtilisez \`/uptimer status\` pour voir ses statistiques.`
      ),
    ],
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('bot');

  if (!user) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un bot à retirer.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!user.bot) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Utilisateur invalide',
          `**${user.tag}** n'est pas un bot.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await UptimeService.removeBot(interaction.guild!.id, user.id);

  if (!result.success) {
    if (result.reason === 'not_tracked') {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Bot non suivi',
            `Le bot **${user.tag}** n'est pas dans la liste de suivi.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Erreur',
          'Une erreur est survenue lors de la suppression. Réessayez plus tard.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      EmbedService.success(
        'Bot retiré du suivi',
        `Le bot **${user.tag}** a été retiré de la liste de suivi et son historique a été supprimé.`
      ),
    ],
  });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const bots = await UptimeService.listBots(interaction.guild!.id);

  if (bots === null) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Erreur',
          'Les statistiques sont temporairement indisponibles. Réessayez plus tard.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (bots.length === 0) {
    await interaction.reply({
      embeds: [
        EmbedService.create(
          'ℹ️ Aucun bot suivi',
          'Aucun bot n\'est actuellement suivi sur ce serveur.\nUtilisez `/uptimer add` pour en ajouter un.',
          config.bot.colors.info
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build pages
  const totalPages = Math.ceil(bots.length / LIST_PAGE_SIZE);

  const buildPage = async (page: number): Promise<EmbedBuilder> => {
    const start = page * LIST_PAGE_SIZE;
    const end = Math.min(start + LIST_PAGE_SIZE, bots.length);
    const pageBots = bots.slice(start, end);

    const lines: string[] = [];
    for (const bot of pageBots) {
      const latestEvent = bot.events[0];
      const status = latestEvent?.status || 'offline';
      const emoji = STATUS_EMOJI[status] || '⚫';
      const label = STATUS_LABEL[status] || 'Inconnu';
      const alertIcon = bot.alertChannelId ? ' 🔔' : '';
      lines.push(`${emoji} <@${bot.botId}> — **${label}**${alertIcon}`);
    }

    const embed = EmbedService.create(
      `📡 Bots suivis — ${interaction.guild!.name}`,
      lines.join('\n'),
      config.bot.colors.primary
    );

    if (totalPages > 1) {
      embed.setFooter({
        text: `Page ${page + 1}/${totalPages} • ${bots.length} bot(s) suivi(s) • ${config.bot.footer.text}`,
      });
    } else {
      embed.setFooter({
        text: `${bots.length} bot(s) suivi(s) • ${config.bot.footer.text}`,
      });
    }

    return embed;
  };

  // Single page — no pagination needed
  if (totalPages === 1) {
    await interaction.reply({ embeds: [await buildPage(0)] });
    return;
  }

  // Multi-page with buttons
  let currentPage = 0;
  const embed = await buildPage(currentPage);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('uptimer_prev')
      .setLabel('◀ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('uptimer_next')
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
    time: 120_000, // 2 minutes
    filter: (i) => i.user.id === interaction.user.id,
  });

  collector.on('collect', async (btnInteraction) => {
    if (btnInteraction.customId === 'uptimer_prev') {
      currentPage = Math.max(0, currentPage - 1);
    } else if (btnInteraction.customId === 'uptimer_next') {
      currentPage = Math.min(totalPages - 1, currentPage + 1);
    }

    const newEmbed = await buildPage(currentPage);
    const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('uptimer_prev')
        .setLabel('◀ Précédent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('uptimer_next')
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    );

    await btnInteraction.update({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on('end', async () => {
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('uptimer_prev')
        .setLabel('◀ Précédent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('uptimer_next')
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    await reply.edit({ components: [disabledRow] }).catch(() => null);
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('bot');

  if (!user) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un bot à inspecter.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!user.bot) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Utilisateur invalide',
          `**${user.tag}** n'est pas un bot.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer because uptime calculations may take time
  await interaction.deferReply();

  const tracked = await UptimeService.getTrackedBot(interaction.guild!.id, user.id);

  if (!tracked) {
    await interaction.editReply({
      embeds: [
        EmbedService.warning(
          'Bot non suivi',
          `Le bot **${user.tag}** n'est pas dans la liste de suivi.\nAjoutez-le avec \`/uptimer add\`.`
        ),
      ],
    });
    return;
  }

  // Current status
  const latestEvent = tracked.events[0];
  const currentStatus = latestEvent?.status || 'offline';
  const statusEmoji = STATUS_EMOJI[currentStatus] || '⚫';
  const statusLabel = STATUS_LABEL[currentStatus] || 'Inconnu';

  // Last status change
  const lastChangeStr = latestEvent
    ? `<t:${Math.floor(latestEvent.timestamp.getTime() / 1000)}:R>`
    : '`Aucune donnée`';

  // Calculate uptime percentages
  let uptime24h: string;
  let uptime7d: string;
  let uptime30d: string;

  try {
    const [u24, u7, u30] = await Promise.all([
      UptimeService.calculateUptime(tracked.id, PERIOD_24H),
      UptimeService.calculateUptime(tracked.id, PERIOD_7D),
      UptimeService.calculateUptime(tracked.id, PERIOD_30D),
    ]);

    uptime24h = u24 !== null ? `${u24}%` : '`N/A`';
    uptime7d = u7 !== null ? `${u7}%` : '`N/A`';
    uptime30d = u30 !== null ? `${u30}%` : '`N/A`';
  } catch {
    uptime24h = '`Indisponible`';
    uptime7d = '`Indisponible`';
    uptime30d = '`Indisponible`';
  }

  // Alert info
  const alertInfo = tracked.alertChannelId
    ? `🔔 Alertes dans <#${tracked.alertChannelId}>`
    : '🔕 Pas d\'alerte configurée';

  const embed = EmbedService.create(
    `📊 Statut de ${user.tag}`,
    `${statusEmoji} **${statusLabel}**`,
    config.bot.colors.primary
  )
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      {
        name: '⏱️ Dernier changement',
        value: lastChangeStr,
        inline: true,
      },
      {
        name: '📅 Suivi depuis',
        value: `<t:${Math.floor(tracked.createdAt.getTime() / 1000)}:D>`,
        inline: true,
      },
      {
        name: '\u200b',
        value: '\u200b',
        inline: true,
      },
      {
        name: '📈 Disponibilité (24h)',
        value: uptime24h,
        inline: true,
      },
      {
        name: '📈 Disponibilité (7j)',
        value: uptime7d,
        inline: true,
      },
      {
        name: '📈 Disponibilité (30j)',
        value: uptime30d,
        inline: true,
      },
      {
        name: '🔔 Alertes',
        value: alertInfo,
        inline: false,
      }
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleAlert(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('bot');
  const channel = interaction.options.getChannel('salon');

  if (!user) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un bot pour configurer l\'alerte.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!user.bot) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Utilisateur invalide',
          `**${user.tag}** n'est pas un bot.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!channel) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un salon pour les alertes.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await UptimeService.setAlertChannel(
    interaction.guild!.id,
    user.id,
    channel.id
  );

  if (!result.success) {
    if (result.reason === 'not_tracked') {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Bot non suivi',
            `Le bot **${user.tag}** n'est pas dans la liste de suivi.\nAjoutez-le d'abord avec \`/uptimer add\`.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Erreur',
          'Une erreur est survenue. Réessayez plus tard.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      EmbedService.success(
        'Alerte configurée',
        `Les changements de statut de **${user.tag}** seront notifiés dans ${channel}.\nDésactivez avec \`/uptimer alert-off\`.`
      ),
    ],
  });
}

async function handleAlertOff(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('bot');

  if (!user) {
    await interaction.reply({
      embeds: [
        EmbedService.warning(
          'Option manquante',
          '⚠️ Merci de sélectionner un bot dont désactiver l\'alerte.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!user.bot) {
    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Utilisateur invalide',
          `**${user.tag}** n'est pas un bot.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await UptimeService.removeAlertChannel(
    interaction.guild!.id,
    user.id
  );

  if (!result.success) {
    if (result.reason === 'not_tracked') {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Bot non suivi',
            `Le bot **${user.tag}** n'est pas dans la liste de suivi.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        EmbedService.error(
          'Erreur',
          'Une erreur est survenue. Réessayez plus tard.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      EmbedService.success(
        'Alerte désactivée',
        `Les alertes de statut pour **${user.tag}** ont été désactivées.`
      ),
    ],
  });
}

export default command;
