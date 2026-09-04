import { createCanvas, loadImage } from '@napi-rs/canvas';
import { GuildMember, PartialGuildMember } from 'discord.js';
import { logger } from '../utils/logger.js';

export class WelcomeCardService {
  /**
   * Generates a welcome card PNG Buffer for a joining member
   */
  static async generateWelcomeCard(
    member: GuildMember,
    customBgUrl?: string | null
  ): Promise<Buffer> {
    return this.createBannerCard(
      member,
      'BIENVENUE SUR LE SERVEUR !',
      `Membre #${member.guild.memberCount} • William by Florynx Labs`,
      customBgUrl
    );
  }

  /**
   * Generates a leave card PNG Buffer for a departing member
   */
  static async generateLeaveCard(
    member: GuildMember | PartialGuildMember,
    customBgUrl?: string | null
  ): Promise<Buffer> {
    return this.createBannerCard(
      member,
      'A BIENTÔT !',
      `Membres restants : ${member.guild.memberCount} • William by Florynx Labs`,
      customBgUrl,
      '#E74C3C' // Red accent for leave card
    );
  }

  /**
   * Generic banner generator for welcome and leave cards
   */
  private static async createBannerCard(
    member: GuildMember | PartialGuildMember,
    titleText: string,
    subtitleText: string,
    customBgUrl?: string | null,
    accentColor: string = '#3B82F6'
  ): Promise<Buffer> {
    const width = 800;
    const height = 350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Draw Custom Background Image or Default Gradient
    let bgLoaded = false;
    if (customBgUrl) {
      try {
        const bgImg = await loadImage(customBgUrl);
        ctx.drawImage(bgImg, 0, 0, width, height);

        // Dark overlay for text readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, 0, width, height);
        bgLoaded = true;
      } catch (err) {
        logger.warn({ err, customBgUrl }, 'Could not load custom background image for card');
      }
    }

    if (!bgLoaded) {
      // Default Background Gradient (Deep Blue #1E3A8A to Dark Navy #071A33)
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#1E3A8A');
      gradient.addColorStop(1, '#071A33');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Decorative Outer Border
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(15, 15, width - 30, height - 30);

    // Subtle inner accent line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, width - 44, height - 44);

    // 3. Draw Title Text
    ctx.fillStyle = accentColor;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(titleText, width / 2, 75);

    // 4. Draw User Avatar Circle
    const avatarRadius = 60;
    const avatarX = width / 2;
    const avatarY = 160;

    try {
      const avatarUrl = member.user
        ? member.user.displayAvatarURL({ extension: 'png', size: 256 })
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

      const avatarImg = await loadImage(avatarUrl);

      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
      ctx.restore();

      // Avatar Ring
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius + 2, 0, Math.PI * 2);
      ctx.stroke();
    } catch (err) {
      logger.warn({ err }, 'Could not load member avatar for banner card, using fallback circle');
      ctx.fillStyle = '#1E3A8A';
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. User Tag Text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    const tagText = member.user ? member.user.tag : 'Membre inconnu';
    ctx.fillText(tagText, width / 2, 255);

    // 6. Subtitle Text
    ctx.fillStyle = accentColor;
    ctx.font = 'italic 20px sans-serif';
    ctx.fillText(subtitleText, width / 2, 295);

    return canvas.toBuffer('image/png');
  }
}
