import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { GuildMember, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { GuildConfigService } from './guildConfigService.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';

export class LevelingService {
  /**
   * Level calculation formula: level = floor(sqrt(XP / 10))
   */
  static calcLevel(xp: number): number {
    return Math.floor(Math.sqrt(xp / 10));
  }

  /**
   * Total XP required for a given level
   */
  static xpForLevel(level: number): number {
    return 10 * Math.pow(level, 2);
  }

  /**
   * Handle passive XP reward for a message (with 60s Redis cooldown)
   */
  static async handleMessageXP(guildId: string, member: GuildMember, channelId: string) {
    try {
      if (member.user.bot) return;

      // 1. Fetch guild config (cached in Redis)
      const guildConfig = await GuildConfigService.getGuildConfig(guildId);
      if (guildConfig.levelingEnabled === false) return;
      if (guildConfig.excludedXpChannelIds?.includes(channelId)) return;

      // 2. Cooldown check via Redis (60 seconds)
      const cooldownKey = `xp:cooldown:${guildId}:${member.id}`;
      const hasCooldown = await redis.get(cooldownKey);
      if (hasCooldown) return;

      // Set 60s cooldown
      await redis.set(cooldownKey, '1', 'EX', 60);

      // Random XP gain between 15 and 25
      const gainedXP = Math.floor(Math.random() * 11) + 15;

      // 3. Upsert MemberXP in DB
      let currentRecord = await prisma.memberXP.findUnique({
        where: { guildId_userId: { guildId, userId: member.id } },
      });

      if (!currentRecord) {
        currentRecord = await prisma.memberXP.create({
          data: { guildId, userId: member.id, xp: gainedXP, level: this.calcLevel(gainedXP) },
        });
      } else {
        const newXP = currentRecord.xp + gainedXP;
        const oldLevel = currentRecord.level;
        const newLevel = this.calcLevel(newXP);

        await prisma.memberXP.update({
          where: { id: currentRecord.id },
          data: { xp: newXP, level: newLevel, lastMessageAt: new Date() },
        });

        // 4. Level Up event
        if (newLevel > oldLevel) {
          logger.info(`[LEVELING] ${member.user.tag} leveled up to Level ${newLevel} in guild ${guildId}`);

          // Check reward role
          const levelRole = await prisma.levelRole.findUnique({
            where: { guildId_level: { guildId, level: newLevel } },
          });

          if (levelRole && member.guild.roles.cache.has(levelRole.roleId)) {
            await member.roles.add(levelRole.roleId).catch(() => null);
          }

          // Send level up notification in channel
          const channel = member.guild.channels.cache.get(channelId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            const embed = EmbedService.success(
              '🎉 Niveau Supérieur !',
              `Félicitations ${member} ! Tu viens de passer au **Niveau ${newLevel}** ! 🚀`
            );
            await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId, userId: member.id }, '[LEVELING] Error handling message XP');
    }
  }

  /**
   * Get user rank position in guild
   */
  static async getUserRank(guildId: string, userId: string) {
    const userRecord = await prisma.memberXP.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    if (!userRecord) {
      return { xp: 0, level: 0, rank: 0 };
    }

    const higherCount = await prisma.memberXP.count({
      where: { guildId, xp: { gt: userRecord.xp } },
    });

    return {
      xp: userRecord.xp,
      level: userRecord.level,
      rank: higherCount + 1,
    };
  }

  /**
   * Generate Rank Card Image via Canvas
   */
  static async generateRankCard(
    username: string,
    avatarUrl: string,
    xp: number,
    level: number,
    rank: number
  ): Promise<Buffer> {
    const width = 800;
    const height = 250;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background Gradient (Dark Forest #0B3D2E to Charcoal #1A1A1A)
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#0B3D2E');
    bgGradient.addColorStop(1, '#111827');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Inner Glassmorphism Card
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.roundRect(20, 20, width - 40, height - 40, 20);
    ctx.fill();

    // Border Gold Accent
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Avatar
    try {
      const avatarImage = await loadImage(avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(100, 125, 60, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImage, 40, 65, 120, 120);
      ctx.restore();

      // Avatar Ring
      ctx.beginPath();
      ctx.arc(100, 125, 60, 0, Math.PI * 2);
      ctx.strokeStyle = '#D4AF37';
      ctx.lineWidth = 4;
      ctx.stroke();
    } catch {
      // Fallback if avatar fails
    }

    // Username & Discrim
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(username, 180, 90);

    // Rank & Level Labels
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#D4AF37';
    ctx.fillText(`RANG #${rank}`, 540, 90);

    ctx.fillStyle = '#2ECC71';
    ctx.fillText(`NIV. ${level}`, 680, 90);

    // XP Progress Bar Math
    const currentLevelXP = this.xpForLevel(level);
    const nextLevelXP = this.xpForLevel(level + 1);
    const xpNeededForNext = nextLevelXP - currentLevelXP;
    const currentProgressXP = Math.max(0, xp - currentLevelXP);
    const progressRatio = Math.min(1, currentProgressXP / (xpNeededForNext || 1));

    // Progress Bar Track Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.roundRect(180, 140, 560, 28, 14);
    ctx.fill();

    // Progress Bar Fill (Gold / Green Gradient)
    if (progressRatio > 0) {
      const fillWidth = Math.max(28, 560 * progressRatio);
      const fillGrad = ctx.createLinearGradient(180, 0, 180 + fillWidth, 0);
      fillGrad.addColorStop(0, '#2ECC71');
      fillGrad.addColorStop(1, '#D4AF37');
      ctx.fillStyle = fillGrad;
      ctx.roundRect(180, 140, fillWidth, 28, 14);
      ctx.fill();
    }

    // XP Text overlay
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${xp} / ${nextLevelXP} XP`, 400, 160);

    return canvas.toBuffer('image/png');
  }
}
