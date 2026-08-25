import { Guild, TextChannel } from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { EmbedService } from '../services/embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Handles guildCreate event when Flowie joins a new server (Zero-Config Onboarding)
 */
export async function handleGuildCreate(guild: Guild) {
  try {
    logger.info(`[ONBOARDING] Flowie joined a new server: "${guild.name}" (${guild.id}) — Member Count: ${guild.memberCount}`);

    // 1. Automatic Zero-Config Onboarding DB & Cache initialization
    await GuildConfigService.getGuildConfig(guild.id);

    // 2. Send welcome onboarding message in system channel or first text channel
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
        { name: '📚 Documentation & Commandes', value: 'Utilisez `/help` pour explorer les 51+ commandes disponibles.', inline: false }
      ).setFooter({ text: `${config.bot.signature}` });

      await (targetChannel as TextChannel).send({ embeds: [embed] }).catch(() => null);
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id }, '[ONBOARDING] Error in guildCreate handler');
  }
}
