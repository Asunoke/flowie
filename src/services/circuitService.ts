import {
  Guild,
  PermissionFlagsBits,
  Role,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { logger } from '../utils/logger.js';
import { GuildConfigService } from './guildConfigService.js';

export type Severity = 'critical' | 'warning' | 'ok';

export interface CircuitFinding {
  id: string;
  category: 'permissions' | 'channels' | 'moderation' | 'economy';
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  fixable: boolean;
  fixData?: Record<string, any>;
}

export interface CircuitScanResult {
  guildId: string;
  healthScore: number;
  findings: CircuitFinding[];
  scannedAt: Date;
}

export class CircuitService {
  private static SCAN_COOLDOWN_SEC = 3600; // 1h
  private static CACHE_TTL_SEC = 3600; // 1h

  /**
   * Check if a guild is on scan cooldown
   */
  static async getCooldownRemaining(guildId: string): Promise<number> {
    const key = `circuit:cooldown:${guildId}`;
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  /**
   * Set scan cooldown for a guild
   */
  static async setCooldown(guildId: string): Promise<void> {
    const key = `circuit:cooldown:${guildId}`;
    await redis.set(key, '1', 'EX', this.SCAN_COOLDOWN_SEC);
  }

  /**
   * Run full structural audit on a Discord server
   */
  static async runScan(guild: Guild): Promise<CircuitScanResult> {
    const findings: CircuitFinding[] = [];

    // Fetch DB Guild Config
    const guildConfig = await GuildConfigService.getGuildConfig(guild.id);

    // ── 1. PERMISSIONS ET RÔLES ─────────────────────────────────────────
    await this.auditPermissionsAndRoles(guild, guildConfig, findings);

    // ── 2. SALONS ───────────────────────────────────────────────────────
    await this.auditChannels(guild, guildConfig, findings);

    // ── 3. MODÉRATION ───────────────────────────────────────────────────
    await this.auditModeration(guild, guildConfig, findings);

    // ── 4. ÉCONOMIE / JEUX ─────────────────────────────────────────────
    await this.auditEconomy(guild, guildConfig, findings);

    // ── CALCUL DU SCORE GLOBAL ──────────────────────────────────────────
    let healthScore = 100;
    for (const finding of findings) {
      if (finding.severity === 'critical') {
        healthScore -= 15;
      } else if (finding.severity === 'warning') {
        healthScore -= 5;
      }
    }
    healthScore = Math.max(0, Math.min(100, healthScore));

    const result: CircuitScanResult = {
      guildId: guild.id,
      healthScore,
      findings,
      scannedAt: new Date(),
    };

    // Save report in DB & Cache
    await this.saveReport(result);
    await this.setCooldown(guild.id);

    return result;
  }

  /**
   * Audit Permissions & Roles
   */
  private static async auditPermissionsAndRoles(
    guild: Guild,
    guildConfig: any,
    findings: CircuitFinding[]
  ): Promise<void> {
    const everyoneRole = guild.roles.everyone;

    // Check @everyone dangerous permissions
    const dangerousPerms = [
      { flag: PermissionFlagsBits.Administrator, name: 'Administrateur' },
      { flag: PermissionFlagsBits.ManageRoles, name: 'Gérer les rôles' },
      { flag: PermissionFlagsBits.ManageChannels, name: 'Gérer les salons' },
      { flag: PermissionFlagsBits.KickMembers, name: 'Expulser des membres' },
      { flag: PermissionFlagsBits.BanMembers, name: 'Bannir des membres' },
      { flag: PermissionFlagsBits.ManageWebhooks, name: 'Gérer les webhooks' },
      { flag: PermissionFlagsBits.ManageGuild, name: 'Gérer le serveur' },
    ];

    const everyoneHasAdmin = everyoneRole.permissions.has(PermissionFlagsBits.Administrator);
    if (everyoneHasAdmin) {
      findings.push({
        id: 'PERM_EVERYONE_ADMIN',
        category: 'permissions',
        severity: 'critical',
        title: 'Permission Administrateur sur @everyone',
        description: 'Le rôle `@everyone` possède la permission Administrateur. Tout membre entrant dispose d\'un contrôle total sur le serveur !',
        recommendation: 'Retirez immédiatement la permission Administrateur du rôle `@everyone`.',
        fixable: true,
      });
    }

    const activeDangerous = dangerousPerms.filter(
      (p) => p.flag !== PermissionFlagsBits.Administrator && everyoneRole.permissions.has(p.flag)
    );

    if (activeDangerous.length > 0 && !everyoneHasAdmin) {
      const permNames = activeDangerous.map((p) => p.name).join(', ');
      findings.push({
        id: 'PERM_EVERYONE_DANGEROUS',
        category: 'permissions',
        severity: 'critical',
        title: 'Permissions dangereuses sur @everyone',
        description: `Le rôle \`@everyone\` possède des permissions à haut risque : **${permNames}**.`,
        recommendation: 'Retirez ces permissions de modération et de gestion du rôle `@everyone`.',
        fixable: true,
      });
    }

    // Check Orphan High-Permission Roles (0 members assigned)
    for (const [, role] of guild.roles.cache) {
      if (role.id === everyoneRole.id || role.managed) continue;

      const hasHighPerms = dangerousPerms.some((p) => role.permissions.has(p.flag));
      if (hasHighPerms && role.members.size === 0) {
        findings.push({
          id: `PERM_ORPHAN_ROLE_${role.id}`,
          category: 'permissions',
          severity: 'warning',
          title: `Rôle orphelin à hautes permissions : ${role.name}`,
          description: `Le rôle <@&${role.id}> détient des permissions élevées mais n'est assigné à aucun membre (0 membre).`,
          recommendation: 'Supprimez ce rôle inutilisé ou attribuez-le aux membres du staff.',
          fixable: false,
        });
      }
    }

    // Check Staff Roles permissions vs config
    const staffRoleIds = new Set<string>();
    if (guildConfig.ticketStaffRoleId) staffRoleIds.add(guildConfig.ticketStaffRoleId);

    // Also look for roles named staff/mod/admin
    guild.roles.cache.forEach((role) => {
      const lowerName = role.name.toLowerCase();
      if (
        (lowerName.includes('staff') || lowerName.includes('mod') || lowerName.includes('admin')) &&
        !role.managed &&
        role.id !== everyoneRole.id
      ) {
        staffRoleIds.add(role.id);
      }
    });

    for (const roleId of staffRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;

      const hasModPerms =
        role.permissions.has(PermissionFlagsBits.BanMembers) ||
        role.permissions.has(PermissionFlagsBits.KickMembers) ||
        role.permissions.has(PermissionFlagsBits.ModerateMembers) ||
        role.permissions.has(PermissionFlagsBits.ManageMessages);

      if (!hasModPerms) {
        findings.push({
          id: `PERM_STAFF_MISSING_PERMS_${role.id}`,
          category: 'permissions',
          severity: 'critical',
          title: `Incohérence Staff : ${role.name}`,
          description: `Le rôle <@&${role.id}> est identifié comme rôle Staff mais ne possède aucune permission de modération réelle (Ban, Kick, Timeout, ManageMessages).`,
          recommendation: 'Accordez les permissions de modération requises à ce rôle ou mettez à jour votre configuration.',
          fixable: false,
        });
      }
    }

    // Bot Role Hierarchy check
    const botMember = guild.members.me;
    if (botMember) {
      const botHighestPos = botMember.roles.highest.position;
      let hasHigherModRole = false;

      guild.roles.cache.forEach((role) => {
        if (
          role.position >= botHighestPos &&
          role.id !== botMember.roles.highest.id &&
          !role.managed
        ) {
          const isModRole =
            role.permissions.has(PermissionFlagsBits.BanMembers) ||
            role.permissions.has(PermissionFlagsBits.KickMembers) ||
            role.permissions.has(PermissionFlagsBits.ManageRoles);
          if (isModRole) hasHigherModRole = true;
        }
      });

      if (hasHigherModRole) {
        findings.push({
          id: 'PERM_BOT_HIERARCHY',
          category: 'permissions',
          severity: 'critical',
          title: 'Hiérarchie du rôle William insuffisante',
          description: `Le rôle le plus haut du bot William (\`${botMember.roles.highest.name}\`) est placé en-dessous de certains rôles possédant des permissions de modération. Le bot ne pourra ni modérer ni gérer ces membres.`,
          recommendation: 'Glissez le rôle du bot William tout en haut de la liste des rôles dans les paramètres Discord du serveur.',
          fixable: false,
        });
      }
    }
  }

  /**
   * Audit Channels
   */
  private static async auditChannels(
    guild: Guild,
    guildConfig: any,
    findings: CircuitFinding[]
  ): Promise<void> {
    // 1. Unrestricted channels (no overwrites at all)
    const textChannels = guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildText
    );

    let unrestrictedCount = 0;
    textChannels.forEach((channel) => {
      if (channel.permissionOverwrites.cache.size === 0) {
        unrestrictedCount++;
      }
    });

    if (unrestrictedCount > 5) {
      findings.push({
        id: 'CHAN_NO_RESTRICTIONS_MANY',
        category: 'channels',
        severity: 'warning',
        title: 'Plusieurs salons sans restriction de permissions',
        description: `${unrestrictedCount} salons textuels ne possèdent aucune restriction ou surcharge de permission spécifique.`,
        recommendation: 'Vérifiez les permissions des salons pour vous assurer qu\'aucun salon confidentiel n\'a été oublié.',
        fixable: false,
      });
    }

    // 2. Mod Log channel accessibility check
    if (guildConfig.logChannelId) {
      const logChannel = guild.channels.cache.get(guildConfig.logChannelId);
      const botMember = guild.members.me;

      if (!logChannel) {
        findings.push({
          id: 'CHAN_LOGS_INACCESSIBLE',
          category: 'channels',
          severity: 'critical',
          title: 'Salon de logs de modération introuvable',
          description: `Un salon de logs est configuré (\`${guildConfig.logChannelId}\`), mais il n'existe plus sur le serveur.`,
          recommendation: 'Configurez un nouveau salon de logs valide avec la commande `/config`.',
          fixable: false,
        });
      } else if (
        botMember &&
        logChannel.isTextBased() &&
        'permissionsFor' in logChannel
      ) {
        const perms = (logChannel as TextChannel).permissionsFor(botMember);
        if (
          !perms ||
          !perms.has(PermissionFlagsBits.ViewChannel) ||
          !perms.has(PermissionFlagsBits.SendMessages)
        ) {
          findings.push({
            id: 'CHAN_LOGS_INACCESSIBLE',
            category: 'channels',
            severity: 'critical',
            title: 'Salon de logs inaccessible au bot',
            description: `Le bot William n'a pas la permission de lire ou d'écrire dans le salon de logs <#${logChannel.id}>.`,
            recommendation: 'Accordez au bot les permissions `Voir le salon` et `Envoyer des messages` dans ce salon.',
            fixable: false,
          });
        }
      }
    }

    // 3. Captcha / Verify channel isolation check
    try {
      const verifySettings = await prisma.verifySettings.findUnique({
        where: { guildId: guild.id },
      });

      if (verifySettings && verifySettings.enabled) {
        const unverifiedRoleId = verifySettings.unverifiedRoleId;
        const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);

        if (!unverifiedRole) {
          findings.push({
            id: 'CHAN_VERIFY_ISOLATION',
            category: 'channels',
            severity: 'critical',
            title: 'Module Verify : Rôle Non Vérifié introuvable',
            description: 'Le système de vérification anti-bot est activé, mais le rôle Non Vérifié configuré n\'existe plus sur le serveur.',
            recommendation: 'Relancez la configuration de la vérification via `/verify setup`.',
            fixable: false,
          });
        } else {
          // Check if unverified role can view channels other than verify channel
          let exposedChannelsCount = 0;
          textChannels.forEach((c) => {
            if (c.id !== verifySettings.verifyChannelId) {
              const perms = c.permissionsFor(unverifiedRole);
              if (perms && perms.has(PermissionFlagsBits.ViewChannel)) {
                exposedChannelsCount++;
              }
            }
          });

          if (exposedChannelsCount > 2) {
            findings.push({
              id: 'CHAN_VERIFY_ISOLATION',
              category: 'channels',
              severity: 'warning',
              title: 'Module Verify : Isolation imparfaite du salon captcha',
              description: `Le rôle Non-Vérifié a accès à ${exposedChannelsCount} autre(s) salon(s) en dehors du salon de vérification captcha.`,
              recommendation: 'Masquez les salons restants au rôle Non Vérifié pour forcer le passage par la vérification.',
              fixable: false,
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id }, 'Error during verify isolation audit');
    }
  }

  /**
   * Audit Moderation Modules
   */
  private static async auditModeration(
    guild: Guild,
    guildConfig: any,
    findings: CircuitFinding[]
  ): Promise<void> {
    // 1. Anti-Raid / Anti-Spam inactive
    if (!guildConfig.antiRaidEnabled) {
      findings.push({
        id: 'MOD_ANTIRAID_INACTIVE',
        category: 'moderation',
        severity: 'warning',
        title: 'Protection Anti-Raid désactivée',
        description: 'Le module Anti-Raid est actuellement désactivé. Le serveur reste vulnérable aux raids de comptes automatisés.',
        recommendation: 'Activez le module Anti-Raid pour sécuriser l\'arrivée des nouveaux membres.',
        fixable: true,
      });
    }

    if (!guildConfig.antiSpamEnabled) {
      findings.push({
        id: 'MOD_ANTISPAM_INACTIVE',
        category: 'moderation',
        severity: 'warning',
        title: 'Protection Anti-Spam désactivée',
        description: 'Le module Anti-Spam est actuellement désactivé.',
        recommendation: 'Activez le module Anti-Spam pour filtrer automatiquement les spams repetitifs.',
        fixable: true,
      });
    }

    // 2. Dormant Staff (No mod cases logged recently on active server)
    try {
      const memberCount = guild.memberCount;
      if (memberCount >= 15) {
        const latestCase = await prisma.moderationCase.findFirst({
          where: { guildId: guild.id },
          orderBy: { createdAt: 'desc' },
        });

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        if (!latestCase || latestCase.createdAt < thirtyDaysAgo) {
          const daysText = latestCase
            ? `depuis le ${latestCase.createdAt.toLocaleDateString('fr-FR')}`
            : 'depuis la création du bot';

          findings.push({
            id: 'MOD_STAFF_DORMANT',
            category: 'moderation',
            severity: 'critical',
            title: 'Équipe de modération inactive',
            description: `Aucune action de modération n'a été enregistrée sur le serveur ${daysText} malgré un serveur actif de ${memberCount} membres.`,
            recommendation: 'Vérifiez la présence des modérateurs ou l\'utilisation des commandes de sanction.',
            fixable: false,
          });
        }
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id }, 'Error auditing moderation activity');
    }
  }

  /**
   * Audit Economy & Games Configuration
   */
  private static async auditEconomy(
    guild: Guild,
    guildConfig: any,
    findings: CircuitFinding[]
  ): Promise<void> {
    try {
      const shopItems = await prisma.shopItem.findMany({
        where: { guildId: guild.id },
      });

      for (const item of shopItems) {
        if (item.roleId) {
          const roleExists = guild.roles.cache.has(item.roleId);
          if (!roleExists) {
            findings.push({
              id: `ECO_ORPHAN_SHOP_ROLE_${item.id}`,
              category: 'economy',
              severity: 'warning',
              title: `Boutique : Rôle introuvable pour "${item.name}"`,
              description: `L'article "${item.name}" (Prix : ${item.price} ${guildConfig.currencyName}) est associé à un rôle qui n'existe plus sur le serveur.`,
              recommendation: 'Mettez à jour ou supprimez cet article de la boutique.',
              fixable: false,
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id }, 'Error auditing economy module');
    }
  }

  /**
   * Save scan result in Prisma DB & Redis cache
   */
  static async saveReport(result: CircuitScanResult): Promise<any> {
    const cacheKey = `circuit:last_report:${result.guildId}`;

    // 1. Cache in Redis
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL_SEC);
    } catch (err) {
      logger.warn({ err, guildId: result.guildId }, 'Failed to cache Circuit report in Redis');
    }

    // 2. Persist in Prisma
    try {
      const saved = await prisma.circuitReport.create({
        data: {
          guildId: result.guildId,
          healthScore: result.healthScore,
          findings: result.findings as any,
          scannedAt: result.scannedAt,
        },
      });
      return saved;
    } catch (err) {
      logger.error({ err, guildId: result.guildId }, 'Failed to save Circuit report in DB');
      return null;
    }
  }

  /**
   * Retrieve last report from Redis cache or Prisma DB
   */
  static async getLastReport(guildId: string): Promise<CircuitScanResult | null> {
    const cacheKey = `circuit:last_report:${guildId}`;

    // 1. Try Redis cache
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.scannedAt = new Date(parsed.scannedAt);
        return parsed;
      }
    } catch (err) {
      logger.warn({ err, guildId }, 'Failed to fetch Circuit report from Redis');
    }

    // 2. Fetch latest from Prisma
    try {
      const dbReport = await prisma.circuitReport.findFirst({
        where: { guildId },
        orderBy: { scannedAt: 'desc' },
      });

      if (!dbReport) return null;

      const result: CircuitScanResult = {
        guildId: dbReport.guildId,
        healthScore: dbReport.healthScore,
        findings: dbReport.findings as unknown as CircuitFinding[],
        scannedAt: dbReport.scannedAt,
      };

      // Populate Redis cache
      await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL_SEC);

      return result;
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to fetch Circuit report from DB');
      return null;
    }
  }

  /**
   * Apply automatic fix for a fixable finding
   */
  static async applyFix(
    guild: Guild,
    findingId: string
  ): Promise<{ success: boolean; message: string }> {
    const everyoneRole = guild.roles.everyone;

    if (findingId === 'PERM_EVERYONE_ADMIN' || findingId === 'PERM_EVERYONE_DANGEROUS') {
      try {
        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return {
            success: false,
            message: 'Le bot William manque de la permission `Gérer les rôles` (Manage Roles).',
          };
        }

        // Revoke dangerous permissions from @everyone
        await everyoneRole.permissions.remove([
          PermissionFlagsBits.Administrator,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.ManageWebhooks,
          PermissionFlagsBits.ManageGuild,
        ]);

        // Invalidate cached report to prompt fresh scan
        await redis.del(`circuit:last_report:${guild.id}`);

        return {
          success: true,
          message: 'Les permissions dangereuses et d\'administration ont été retirées du rôle `@everyone` avec succès.',
        };
      } catch (err: any) {
        logger.error({ err, guildId: guild.id }, 'Failed to fix PERM_EVERYONE permissions');
        return {
          success: false,
          message: `Échec lors de la mise à jour des permissions : ${err.message || err}`,
        };
      }
    }

    if (findingId === 'MOD_ANTIRAID_INACTIVE') {
      try {
        await GuildConfigService.updateGuildConfig(guild.id, { antiRaidEnabled: true });
        await redis.del(`circuit:last_report:${guild.id}`);
        return {
          success: true,
          message: 'Le module Anti-Raid a été activé avec succès sur le serveur.',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Échec lors de l'activation de l'Anti-Raid : ${err.message || err}`,
        };
      }
    }

    if (findingId === 'MOD_ANTISPAM_INACTIVE') {
      try {
        await GuildConfigService.updateGuildConfig(guild.id, { antiSpamEnabled: true });
        await redis.del(`circuit:last_report:${guild.id}`);
        return {
          success: true,
          message: 'Le module Anti-Spam a été activé avec succès sur le serveur.',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Échec lors de l'activation de l'Anti-Spam : ${err.message || err}`,
        };
      }
    }

    return {
      success: false,
      message: 'Ce problème ne possède pas de correction automatique configurable.',
    };
  }
}
