import { Guild, GuildMember, PartialGuildMember, PermissionFlagsBits, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { GuildConfigService } from './guildConfigService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface LegacyMemberStats {
  isSignificant: boolean;
  tenureDays: number;
  tenureText: string;
  level: number;
  xp: number;
  totalInvites: number;
  staffRoles: { roleName: string; grantedAt: Date; revokedAt: Date | null }[];
  reasons: string[];
}

export class LegacyService {
  /**
   * Get or create default LegacySettings for a guild
   */
  static async getSettings(guildId: string) {
    let settings = await prisma.legacySettings.findUnique({
      where: { guildId },
    });

    if (!settings) {
      settings = await prisma.legacySettings.create({
        data: {
          guildId,
          minTenureDays: 90,
          minLevel: 10,
          minInvites: 5,
        },
      });
    }

    return settings;
  }

  /**
   * Update LegacySettings for a guild
   */
  static async updateSettings(
    guildId: string,
    data: { channelId?: string | null; minTenureDays?: number; minLevel?: number | null; minInvites?: number | null }
  ) {
    return await prisma.legacySettings.upsert({
      where: { guildId },
      create: {
        guildId,
        channelId: data.channelId,
        minTenureDays: data.minTenureDays ?? 90,
        minLevel: data.minLevel ?? 10,
        minInvites: data.minInvites ?? 5,
      },
      update: data,
    });
  }

  /**
   * Track staff role assignments and revocations on guildMemberUpdate
   */
  static async handleMemberRoleUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember
  ) {
    try {
      const guildId = newMember.guild.id;
      const userId = newMember.id;

      const oldRoles = new Set(oldMember.roles.cache.keys());
      const newRoles = new Set(newMember.roles.cache.keys());

      const guildConfig = await GuildConfigService.getGuildConfig(guildId);
      const staffRoleId = guildConfig.ticketStaffRoleId;

      // Identify added roles
      const addedRoles = newMember.roles.cache.filter((r) => !oldRoles.has(r.id));
      // Identify removed roles
      const removedRoles = oldMember.roles.cache.filter((r) => !newRoles.has(r.id));

      for (const [, role] of addedRoles) {
        const isStaffRole =
          role.id === staffRoleId ||
          role.permissions.has(PermissionFlagsBits.Administrator) ||
          role.permissions.has(PermissionFlagsBits.ManageGuild) ||
          role.permissions.has(PermissionFlagsBits.KickMembers) ||
          role.permissions.has(PermissionFlagsBits.BanMembers);

        if (isStaffRole) {
          await prisma.staffHistory.create({
            data: {
              guildId,
              userId,
              roleName: role.name,
              grantedAt: new Date(),
            },
          });
          logger.info(`[LEGACY_STAFF] Tracked staff role grant (${role.name}) for user ${userId} in ${guildId}`);
        }
      }

      for (const [, role] of removedRoles) {
        const activeRecord = await prisma.staffHistory.findFirst({
          where: {
            guildId,
            userId,
            roleName: role.name,
            revokedAt: null,
          },
          orderBy: { grantedAt: 'desc' },
        });

        if (activeRecord) {
          await prisma.staffHistory.update({
            where: { id: activeRecord.id },
            data: { revokedAt: new Date() },
          });
          logger.info(`[LEGACY_STAFF] Tracked staff role revocation (${role.name}) for user ${userId} in ${guildId}`);
        }
      }
    } catch (err) {
      logger.error({ err }, '[LEGACY_STAFF] Error in handleMemberRoleUpdate');
    }
  }

  /**
   * Evaluate if a member meets any significance criteria for a tribute
   */
  static async checkMemberSignificance(
    guildId: string,
    member: GuildMember | PartialGuildMember
  ): Promise<LegacyMemberStats> {
    const settings = await this.getSettings(guildId);
    const userId = member.id;

    // 1. Calculate tenure
    const joinedAt = member.joinedAt || new Date();
    const msDiff = Date.now() - joinedAt.getTime();
    const tenureDays = Math.floor(msDiff / (1000 * 60 * 60 * 24));

    // Format tenure text
    const years = Math.floor(tenureDays / 365);
    const months = Math.floor((tenureDays % 365) / 30);
    const days = tenureDays % 30;

    let tenureText = '';
    if (years > 0) tenureText += `${years} an(s) `;
    if (months > 0) tenureText += `${months} mois `;
    if (years === 0 && months === 0) tenureText += `${days} jour(s)`;
    else if (days > 0) tenureText += `et ${days} jour(s)`;
    tenureText = tenureText.trim();

    // 2. Fetch Leveling Stats (MemberXP)
    const memberXP = await prisma.memberXP.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    const level = memberXP?.level || 0;
    const xp = memberXP?.xp || 0;

    // 3. Fetch Invites Stats
    const inviteJoins = await prisma.inviteJoin.count({
      where: { guildId, inviterId: userId, leftEarly: false },
    });
    const bonusRec = await prisma.inviteBonus.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    const bonusAmount = bonusRec?.amount || 0;
    const totalInvites = Math.max(0, inviteJoins + bonusAmount);

    // 4. Fetch Staff History
    const staffRoles = await prisma.staffHistory.findMany({
      where: { guildId, userId },
      orderBy: { grantedAt: 'asc' },
    });

    // Check criteria
    const reasons: string[] = [];
    const isTenureMet = tenureDays >= settings.minTenureDays;
    if (isTenureMet) reasons.push(`Ancienneté (${tenureDays}d >= ${settings.minTenureDays}d)`);

    const isLevelMet = settings.minLevel !== null && level >= settings.minLevel;
    if (isLevelMet) reasons.push(`Niveau d XP (${level} >= ${settings.minLevel})`);

    const isInvitesMet = settings.minInvites !== null && totalInvites >= settings.minInvites;
    if (isInvitesMet) reasons.push(`Invitations (${totalInvites} >= ${settings.minInvites})`);

    const isStaffMet = staffRoles.length > 0;
    if (isStaffMet) reasons.push(`Historique Staff (${staffRoles.length} rôle(s))`);

    const isSignificant = isTenureMet || isLevelMet || isInvitesMet || isStaffMet;

    return {
      isSignificant,
      tenureDays,
      tenureText,
      level,
      xp,
      totalInvites,
      staffRoles: staffRoles.map((s: any) => ({
        roleName: s.roleName,
        grantedAt: s.grantedAt,
        revokedAt: s.revokedAt,
      })),
      reasons,
    };
  }

  /**
   * Generate the warm farewell tribute Embed
   */
  static generateTributeEmbed(
    guild: Guild,
    userMeta: { tag: string; avatarUrl: string; id: string },
    stats: LegacyMemberStats
  ) {
    const embed = EmbedService.gold(
      `🕊️ Hommage & Au Revoir — ${userMeta.tag}`,
      `Aujourd'hui, nous disons au revoir et merci à **${userMeta.tag}** pour son parcours et sa contribution au sein du serveur **${guild.name}**.\n\n` +
        `> *"Chaque membre laisse une empreinte unique. Merci pour les moments partagés !"*`
    )
      .setThumbnail(userMeta.avatarUrl)
      .addFields(
        { name: '⏳ Durée de Présence', value: `\`${stats.tenureText}\` *(${stats.tenureDays} jours au total)*`, inline: true }
      );

    if (stats.level > 0) {
      embed.addFields({
        name: '⭐ Niveau XP Atteint',
        value: `**Niveau ${stats.level}** \`(${stats.xp.toLocaleString('fr-FR')} XP)\``,
        inline: true,
      });
    }

    if (stats.totalInvites > 0) {
      embed.addFields({
        name: '✉️ Invitations Générées',
        value: `\`${stats.totalInvites} membre(s) invités\``,
        inline: true,
      });
    }

    if (stats.staffRoles.length > 0) {
      const staffLines = stats.staffRoles.map((s: any) => {
        const fromDate = s.grantedAt.toLocaleDateString('fr-FR');
        const toDate = s.revokedAt ? s.revokedAt.toLocaleDateString('fr-FR') : 'Jusqu au départ';
        return `• **${s.roleName}** (*Du ${fromDate} au ${toDate}*)`;
      });
      embed.addFields({ name: '👑 Parcours & Rôles Occupés', value: staffLines.join('\n'), inline: false });
    }

    embed.setFooter({ text: `${config.bot.footer.text} • Hommage au Départ` });

    return embed;
  }

  /**
   * Trigger departure tribute when a member leaves (guildMemberRemove)
   */
  static async handleMemberLeave(member: GuildMember | PartialGuildMember) {
    try {
      const guild = member.guild;
      const settings = await this.getSettings(guild.id);

      if (!settings.channelId) {
        return; // Tribute channel not configured
      }

      const channel = guild.channels.cache.get(settings.channelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        return;
      }

      // Evaluate significance
      const stats = await this.checkMemberSignificance(guild.id, member);
      if (!stats.isSignificant) {
        logger.info(`[LEGACY] Member ${member.user?.tag || member.id} left guild ${guild.id} but did not meet significance criteria. Skipping tribute.`);
        return;
      }

      const avatarUrl =
        member.user?.displayAvatarURL({ size: 256 }) ||
        'https://cdn.discordapp.com/embed/avatars/0.png';
      const tag = member.user?.tag || 'Un membre remarquable';

      const embed = this.generateTributeEmbed(guild, { tag, avatarUrl, id: member.id }, stats);

      await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
      logger.info(`[LEGACY] Sent departure tribute for ${tag} in channel ${settings.channelId}`);
    } catch (err) {
      logger.error({ err }, '[LEGACY] Error in handleMemberLeave');
    }
  }

  /**
   * Generate preview tribute for staff command /legacy-preview
   */
  static async generatePreview(guild: Guild, member: GuildMember) {
    const stats = await this.checkMemberSignificance(guild.id, member);
    const avatarUrl = member.user.displayAvatarURL({ size: 256 });
    const tag = member.user.tag;

    const embed = this.generateTributeEmbed(guild, { tag, avatarUrl, id: member.id }, stats);

    return { embed, stats };
  }
}
