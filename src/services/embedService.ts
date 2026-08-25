import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { config } from '../config/index.js';

export class EmbedService {
  /**
   * Base embed configured with Flowie styling & footer
   */
  static create(title?: string, description?: string, color: ColorResolvable = config.bot.colors.primary): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTimestamp()
    const footerObj: { text: string; iconURL?: string } = { text: config.bot.footer.text };
    if (config.bot.footer.iconUrl) {
      footerObj.iconURL = config.bot.footer.iconUrl;
    }
    embed.setFooter(footerObj);

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);

    return embed;
  }

  /**
   * Success Embed (Forest Green or Emerald)
   */
  static success(title: string, description: string): EmbedBuilder {
    return this.create(`✅ ${title}`, description, config.bot.colors.primary);
  }

  /**
   * Error Embed
   */
  static error(title: string, description: string): EmbedBuilder {
    return this.create(`❌ ${title}`, description, config.bot.colors.error);
  }

  /**
   * Warning Embed
   */
  static warning(title: string, description: string): EmbedBuilder {
    return this.create(`⚠️ ${title}`, description, config.bot.colors.warning);
  }

  /**
   * Info / Gold Accent Embed
   */
  static gold(title: string, description: string): EmbedBuilder {
    return this.create(title, description, config.bot.colors.gold);
  }
}
