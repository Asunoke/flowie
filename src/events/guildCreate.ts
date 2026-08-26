import {
  Guild,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent,
} from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { PlanService } from '../services/planService.js';
import { EmbedService } from '../services/embedService.js';
import { InviteService } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Handles guildCreate event when Flowie joins a new server
 */
export async function handleGuildCreate(guild: Guild) {
  try {
    logger.info(`[GUILD_JOIN] Flowie joined server "${guild.name}" (${guild.id}) — Member Count: ${guild.memberCount}`);

    // Cache invites for Invite Tracking
    await InviteService.cacheGuildInvites(guild);

    // 1. Identify owner or bot inviter from Audit Logs (fallback to guild.ownerId)
    let ownerUserId = guild.ownerId;
    try {
      if (guild.members.me?.permissions.has('ViewAuditLog')) {
        const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 }).catch(() => null);
        const botAddLog = auditLogs?.entries.first();
        if (botAddLog && botAddLog.target?.id === guild.client.user?.id) {
          ownerUserId = botAddLog.executor?.id || guild.ownerId;
        }
      }
    } catch {
      // Fallback to guild.ownerId
    }

    // 2. Quota Check via PlanService
    const quotaCheck = await PlanService.checkQuotaForNewGuild(guild.id, ownerUserId);

    if (quotaCheck.allowed) {
      // Allowed! Initialize Zero-Config Onboarding
      await GuildConfigService.getGuildConfig(guild.id);

      const targetChannel =
        guild.systemChannel ||
        guild.channels.cache.find(
          (c) => c.isTextBased() && 'send' in c && c.permissionsFor(guild.members.me!)?.has('SendMessages')
        );

      if (targetChannel && 'send' in targetChannel) {
        const embed = EmbedService.gold(
          '🌲 Bienvenue sur Flowie by Florynx Labs !',
          `Merci d'avoir ajouté Flowie à **${guild.name}**.\n\n` +
            `Flowie est prêt à l'emploi avec les paramètres par défaut.\n` +
            `Pour configurer le serveur en quelques clics, utilisez la commande **/setup** ou **/help**.`
        ).addFields(
          { name: '⚡ Assistant de configuration', value: 'Lancez `/setup` pour un assistant interactif pas-à-pas.', inline: false },
          { name: '📚 Documentation & Commandes', value: 'Utilisez `/help` pour explorer les 52+ commandes disponibles.', inline: false }
        ).setFooter({ text: `${config.bot.signature}` });

        await (targetChannel as TextChannel).send({ embeds: [embed] }).catch(() => null);
      }
    } else {
      // Quota exceeded! Lock server and notify inviter/owner
      logger.warn(
        `[PLAN_BLOCK] Guild "${guild.name}" (${guild.id}) blocked — Owner ${ownerUserId} exceeded active guild limit (${quotaCheck.quota.activeCount}/${quotaCheck.quota.maxGuilds})`
      );

      const inviteUrl = config.scaling.officialDiscordInvite || 'https://discord.gg/florynxlabs';

      const lockEmbed = EmbedService.gold(
        '🔒 Limite de plan atteinte — Serveur non activé',
        'Flowie fonctionne actuellement en plan gratuit limité à **1 serveur par propriétaire**.\n' +
          'Vous avez déjà Flowie actif sur un autre serveur.'
      )
        .addFields(
          {
            name: '✨ Passation au Plan Premium',
            value:
              'Pour débloquer plusieurs serveurs, ouvrez un ticket sur notre serveur officiel — un membre de l\'équipe (owner ou gérant) pourra vous ajouter à la liste premium (whitelist).',
            inline: false,
          },
          {
            name: '📊 Statut actuel',
            value: `**Serveurs actifs** : \`${quotaCheck.quota.activeCount} / ${quotaCheck.quota.maxGuilds}\``,
            inline: true,
          }
        )
        .setFooter({ text: `${config.bot.signature} • Support & Whitelist Florynx Labs` });

      const linkButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Rejoindre le serveur officiel Florynx Labs 🚀')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl)
      );

      // Attempt sending to first available text channel
      const textChannel = guild.channels.cache.find(
        (c) => c.isTextBased() && 'send' in c && c.permissionsFor(guild.members.me!)?.has('SendMessages')
      ) as TextChannel | undefined;

      let sent = false;
      if (textChannel) {
        sent = !!(await textChannel.send({ embeds: [lockEmbed], components: [linkButton] }).catch(() => null));
      }

      // If channel send failed, send DM to owner/inviter
      if (!sent) {
        const ownerMember = await guild.members.fetch(ownerUserId).catch(() => null);
        if (ownerMember) {
          await ownerMember.send({ embeds: [lockEmbed], components: [linkButton] }).catch(() => null);
        }
      }

      // Handle LOCKED_MODE action ('leave' or 'stay_disabled')
      if (config.scaling.lockedMode === 'leave') {
        logger.info(`[PLAN_LEAVE] Auto-leaving blocked guild "${guild.name}" in 60s...`);
        setTimeout(async () => {
          await guild.leave().catch(() => null);
        }, 60_000);
      }
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id }, '[ONBOARDING] Error in guildCreate handler');
  }
}
