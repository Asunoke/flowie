import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { ContextMenuCommand } from '../../types/command.js';
import { TranslateService } from '../../services/translateService.js';
import { config } from '../../config/index.js';

const LANG_FLAG: Record<string, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
  de: '🇩🇪',
  it: '🇮🇹',
  pt: '🇵🇹',
  nl: '🇳🇱',
  ru: '🇷🇺',
  ja: '🇯🇵',
  zh: '🇨🇳',
  ar: '🇸🇦',
  ko: '🇰🇷',
  tr: '🇹🇷',
  pl: '🇵🇱',
  uk: '🇺🇦',
  unknown: '🌍',
};

const translateContextCommand: ContextMenuCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Traduire en Français')
    .setType(ApplicationCommandType.Message),
  category: 'utility',
  cooldown: 5,
  async execute(interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction) {
    if (!interaction.isMessageContextMenuCommand()) return;

    const targetMessage = interaction.targetMessage;
    const rawContent = targetMessage.content?.trim();

    if (!rawContent) {
      await interaction.reply({
        content: '❌ Ce message ne contient pas de texte à traduire.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await TranslateService.toFrench(rawContent);

      const langEmoji = LANG_FLAG[result.detectedLanguage] ?? LANG_FLAG.unknown;
      const truncatedOriginal = rawContent.length > 800 ? rawContent.slice(0, 797) + '...' : rawContent;
      const truncatedTranslation = result.translatedText.length > 1024
        ? result.translatedText.slice(0, 1021) + '...'
        : result.translatedText;

      const embed = new EmbedBuilder()
        .setColor(config.bot.colors.primary)
        .setTitle('🌍 Traduction en Français')
        .addFields(
          { name: `${langEmoji} Texte original`, value: `> ${truncatedOriginal.replace(/\n/g, '\n> ')}`, inline: false },
          { name: '🇫🇷 Traduction', value: truncatedTranslation, inline: false }
        )
        .setFooter({ text: `${config.bot.signature} • Traduction automatique — LibreTranslate` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        content: `❌ **Erreur de traduction :** ${err.message || 'Une erreur inconnue est survenue.'}`,
      });
    }
  },
};

export default translateContextCommand;
