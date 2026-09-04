import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Assistant pas-à-pas interactif pour configurer le serveur en quelques minutes')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const guildId = interaction.guild.id;
    let currentConfig = await GuildConfigService.getGuildConfig(guildId);

    // Step 1: Overview & Welcome
    const embedStep1 = EmbedService.gold(
      `⚙️ Assistant de Configuration — ${interaction.guild.name}`,
      'Bienvenue dans l\'assistant interactif William !\n' +
        'Suivez les étapes ci-dessous pour configurer les fonctionnalités principales de votre serveur.\n\n' +
        '**Étape 1/3** : Choisissez la langue et la monnaie du serveur.'
    ).addFields(
      { name: '🌐 Langue actuelle', value: `\`${currentConfig.language.toUpperCase()}\``, inline: true },
      { name: '🪙 Monnaie actuelle', value: `\`${currentConfig.currencyName}\``, inline: true }
    );

    const rowStep1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_lang_fr')
        .setLabel('Français 🇫🇷')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('setup_lang_en')
        .setLabel('English 🇬🇧')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setup_next_modlog')
        .setLabel('Étape suivante (Modlog) ➡️')
        .setStyle(ButtonStyle.Success)
    );

    const reply = await interaction.reply({
      embeds: [embedStep1],
      components: [rowStep1],
      fetchReply: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (btn) => {
      await btn.deferUpdate();

      if (btn.customId === 'setup_lang_fr') {
        currentConfig = await GuildConfigService.updateGuildConfig(guildId, { language: 'fr' });
      } else if (btn.customId === 'setup_lang_en') {
        currentConfig = await GuildConfigService.updateGuildConfig(guildId, { language: 'en' });
      } else if (btn.customId === 'setup_next_modlog') {
        collector.stop('modlog');

        // Step 2: Modlog selection
        const embedStep2 = EmbedService.gold(
          '⚙️ Étape 2/3 — Salon de Modération & Logs',
          'Sélectionnez le salon textuel où William enverra les logs de modération, d\'alertes et de tickets.'
        );

        const channelSelect = new ChannelSelectMenuBuilder()
          .setCustomId('setup_select_modlog')
          .setPlaceholder('Sélectionnez un salon textuel pour les logs...')
          .setChannelTypes(ChannelType.GuildText);

        const rowStep2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);

        const reply2 = await interaction.followUp({
          embeds: [embedStep2],
          components: [rowStep2],
          flags: MessageFlags.Ephemeral,
          fetchReply: true,
        });

        const collector2 = reply2.createMessageComponentCollector({
          componentType: ComponentType.ChannelSelect,
          time: 60_000,
          filter: (i) => i.user.id === interaction.user.id,
        });

        collector2.on('collect', async (selectInt) => {
          const selectedChannelId = selectInt.values[0];
          currentConfig = await GuildConfigService.updateGuildConfig(guildId, { logChannelId: selectedChannelId });

          const summaryEmbed = EmbedService.success(
            '🎉 Configuration terminée avec succès !',
            `Les paramètres principaux de **${interaction.guild!.name}** ont été enregistrés.`
          ).addFields(
            { name: '🌐 Langue', value: `\`${currentConfig.language.toUpperCase()}\``, inline: true },
            { name: '🪙 Monnaie', value: `\`${currentConfig.currencyName}\``, inline: true },
            { name: '📜 Salon Logs', value: `<#${currentConfig.logChannelId}>`, inline: true }
          ).setFooter({ text: `${config.bot.signature}` });

          await selectInt.reply({ embeds: [summaryEmbed], flags: MessageFlags.Ephemeral });
        });
      }
    });
  },
};

export default command;
