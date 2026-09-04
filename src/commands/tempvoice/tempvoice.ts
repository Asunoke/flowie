import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChannelSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CategoryChannel,
  VoiceChannel,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { TempVoiceService } from '../../services/tempVoiceService.js';
import { logger } from '../../utils/logger.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Configuration des salons vocaux temporaires "Join to Create"')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Lancer l assistant interactif de configuration des salons vocaux temporaires')
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Désactiver le système de salons vocaux temporaires')
    ),
  category: 'tempvoice',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    // ── Subcommand: DISABLE ────────────────────────────────────────────────
    if (subcommand === 'disable') {
      const settings = await TempVoiceService.getSettings(interaction.guild.id);
      if (!settings || !settings.enabled) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Système déjà désactivé',
              'Le système de salons vocaux temporaires n\'est pas actif sur ce serveur.'
            ),
          ],
        });
        return;
      }

      await TempVoiceService.disableTempVoice(interaction.guild.id);

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Salons temporaires désactivés',
            'Le système de création automatique de salons vocaux temporaires a été désactivé.'
          ),
        ],
      });
      return;
    }

    // ── Subcommand: SETUP ──────────────────────────────────────────────────
    if (subcommand === 'setup') {
      // Check permissions
      const botMember = interaction.guild.members.me;
      const missingPermissions: string[] = [];

      if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        missingPermissions.push('`Gérer les salons` (Manage Channels)');
      }
      if (!botMember?.permissions.has(PermissionFlagsBits.MoveMembers)) {
        missingPermissions.push('`Déplacer des membres` (Move Members)');
      }

      if (missingPermissions.length > 0) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Permissions insuffisantes',
              `Il manque au bot William les permissions suivantes :\n- ${missingPermissions.join('\n- ')}`
            ),
          ],
        });
        return;
      }

      let selectedCategoryId: string | null = null;
      let selectedTriggerId: string | null = null;
      let templateName = '🔊 Salon de {user}';

      // ── Step 1 Embed & Component: Category Selection ──
      const step1Embed = EmbedService.create(
        '⚙️ Setup Vocaux Temporaires — Étape 1/3 : Catégorie',
        'Veuillez sélectionner la catégorie Discord où les salons vocaux temporaires seront créés :'
      );

      const categorySelect = new ChannelSelectMenuBuilder()
        .setCustomId('tempvoice_setup_category_select')
        .setPlaceholder('Sélectionnez une catégorie...')
        .setChannelTypes(ChannelType.GuildCategory);

      const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(categorySelect);

      const responseMessage = await interaction.reply({
        embeds: [step1Embed],
        components: [row1],
        fetchReply: true,
      });

      const collector = responseMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 180000, // 3 mins
      });

      collector.on('collect', async (i) => {
        try {
          const guild = interaction.guild;
          if (!guild) return;

          // ── Step 1: Category Selected ──
          if (i.isChannelSelectMenu() && i.customId === 'tempvoice_setup_category_select') {
            selectedCategoryId = i.values[0];

            const step2Embed = EmbedService.create(
              '⚙️ Setup Vocaux Temporaires — Étape 2/3 : Salon déclencheur',
              `Catégorie sélectionnée : <#${selectedCategoryId}>\n\nVeuillez choisir un salon vocal existant pour servir de déclencheur ("➕ Créer un vocal") ou cliquez sur le bouton pour en créer un automatiquement.`
            );

            const voiceSelect = new ChannelSelectMenuBuilder()
              .setCustomId('tempvoice_setup_trigger_select')
              .setPlaceholder('Sélectionnez le salon vocal déclencheur...')
              .setChannelTypes(ChannelType.GuildVoice);

            const autoCreateBtn = new ButtonBuilder()
              .setCustomId('tempvoice_setup_autocreate_trigger')
              .setLabel('Créer "➕ Créer un vocal" automatiquement')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('➕');

            const row2a = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(voiceSelect);
            const row2b = new ActionRowBuilder<ButtonBuilder>().addComponents(autoCreateBtn);

            await i.update({
              embeds: [step2Embed],
              components: [row2a, row2b],
            });
            return;
          }

          // ── Step 2a: Trigger Voice Channel Selected ──
          if (i.isChannelSelectMenu() && i.customId === 'tempvoice_setup_trigger_select') {
            selectedTriggerId = i.values[0];
          }

          // ── Step 2b: Auto-Create Trigger Button Clicked ──
          if (i.isButton() && i.customId === 'tempvoice_setup_autocreate_trigger') {
            if (!selectedCategoryId) return;

            const category = guild.channels.cache.get(selectedCategoryId);
            const createdTrigger = await guild.channels.create({
              name: '➕ Créer un vocal',
              type: ChannelType.GuildVoice,
              parent: category && category instanceof CategoryChannel ? category.id : selectedCategoryId,
              reason: 'Salon déclencheur automatique pour salons temporaires William',
            });

            selectedTriggerId = createdTrigger.id;
          }

          // Move to Step 3 if trigger is set
          if (selectedTriggerId && (i.customId === 'tempvoice_setup_trigger_select' || i.customId === 'tempvoice_setup_autocreate_trigger')) {
            const step3Embed = EmbedService.create(
              '⚙️ Setup Vocaux Temporaires — Étape 3/3 : Confirmation',
              `Récapitulatif de la configuration :\n- **Catégorie** : <#${selectedCategoryId}>\n- **Salon Déclencheur** : <#${selectedTriggerId}>\n- **Template de Nom** : \`${templateName}\`\n\nCliquez sur **Activer les salons temporaires** pour valider la configuration.`
            );

            const confirmBtn = new ButtonBuilder()
              .setCustomId('tempvoice_setup_confirm_btn')
              .setLabel('Activer les salons temporaires')
              .setStyle(ButtonStyle.Success)
              .setEmoji('⚡');

            const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn);

            await i.update({
              embeds: [step3Embed],
              components: [row3],
            });
            return;
          }

          // ── Step 3: Confirmation Button Clicked ──
          if (i.isButton() && i.customId === 'tempvoice_setup_confirm_btn') {
            if (!selectedCategoryId || !selectedTriggerId) {
              await i.update({
                embeds: [EmbedService.error('Erreur', 'Configuration incomplète. Veuillez recommencer.')],
                components: [],
              });
              return;
            }

            await i.deferUpdate();

            await TempVoiceService.saveSettings({
              guildId: guild.id,
              triggerChannelId: selectedTriggerId,
              categoryId: selectedCategoryId,
              nameTemplate: templateName,
              maxChannels: 50,
              enabled: true,
            });

            const successEmbed = EmbedService.success(
              'Salons temporaires configurés ! 🎉',
              `Le système **Join to Create** est actif !\n- **Salon Déclencheur** : <#${selectedTriggerId}>\n- **Catégorie** : <#${selectedCategoryId}>\n- **Template** : \`${templateName}\``
            );

            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });

            collector.stop('completed');
          }
        } catch (err) {
          logger.error({ err }, 'Error during tempvoice setup interactive flow');
          await interaction.followUp({
            embeds: [EmbedService.error('Erreur', 'Une erreur est survenue pendant la configuration.')],
            flags: 64,
          }).catch(() => null);
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'completed') {
          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Temps écoulé',
                'La configuration a expiré. Veuillez relancer `/tempvoice setup`.'
              ),
            ],
            components: [],
          }).catch(() => null);
        }
      });

      return;
    }
  },
};

export default command;
