import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { VerifyService } from '../../services/verifyService.js';
import { logger } from '../../utils/logger.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Configuration et gestion du système de vérification anti-bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Lancer l assistant interactif de configuration de la vérification anti-bot')
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Désactiver le système de vérification sans supprimer les rôles')
    ),
  category: 'verify',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    // ── Subcommand: DISABLE ────────────────────────────────────────────────
    if (subcommand === 'disable') {
      const settings = await VerifyService.getSettings(interaction.guild.id);
      if (!settings || !settings.enabled) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Système déjà désactivé',
              'La vérification anti-bot n\'est pas activée sur ce serveur.'
            ),
          ],
        });
        return;
      }

      await VerifyService.disableVerification(interaction.guild.id);

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Vérification désactivée',
            'Le système de vérification anti-bot a été désactivé. Les nouveaux membres recevront les accès standards sans passer par le captcha.\n*Note : Les rôles et salons créés ont été conservés.*'
          ),
        ],
      });
      return;
    }

    // ── Subcommand: SETUP ──────────────────────────────────────────────────
    if (subcommand === 'setup') {
      // 1. Check Bot Permissions
      const botMember = interaction.guild.members.me;
      const missingPermissions: string[] = [];

      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        missingPermissions.push('`Gérer les rôles` (Manage Roles)');
      }
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        missingPermissions.push('`Gérer les salons` (Manage Channels)');
      }

      if (missingPermissions.length > 0) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Permissions insuffisantes',
              `Le bot Flowie ne peut pas configurer le système de vérification car il lui manque les permissions suivantes :\n- ${missingPermissions.join(
                '\n- '
              )}\n\nVeuillez accorder ces permissions au bot et relancer la commande \`/verify setup\`.`
            ),
          ],
        });
        return;
      }

      // Step variables
      let selectedChannelId: string | null = null;
      let selectedRoleId: string | null = null;

      // ── Step 1 Embed & Component ──
      const step1Embed = EmbedService.create(
        '⚙️ Setup Anti-Bot — Étape 1/3 : Salon Captcha',
        'Veuillez sélectionner le salon textuel réservé à la vérification anti-bot.\nCe salon sera le seul visible par les nouveaux membres non vérifiés.'
      );

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('verify_setup_channel_select')
        .setPlaceholder('Sélectionnez le salon captcha...')
        .setChannelTypes(ChannelType.GuildText);

      const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);

      const responseMessage = await interaction.reply({
        embeds: [step1Embed],
        components: [row1],
        fetchReply: true,
      });

      // Collector for setup interaction
      const collector = responseMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 180000, // 3 minutes timeout
      });

      collector.on('collect', async (i) => {
        try {
          const guild = interaction.guild;
          if (!guild) return;

          // ── Step 1: Channel Selected ──
          if (i.isChannelSelectMenu() && i.customId === 'verify_setup_channel_select') {
            selectedChannelId = i.values[0];

            const step2Embed = EmbedService.create(
              '⚙️ Setup Anti-Bot — Étape 2/3 : Rôle à attribuer',
              `Salon captcha sélectionné : <#${selectedChannelId}>\n\nVeuillez maintenant choisir le rôle qui sera attribué automatiquement après la vérification réussie du membre (ex: *Membre*).`
            );

            const roleSelect = new RoleSelectMenuBuilder()
              .setCustomId('verify_setup_role_select')
              .setPlaceholder('Sélectionnez le rôle des membres vérifiés...');

            const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);

            await i.update({
              embeds: [step2Embed],
              components: [row2],
            });
            return;
          }

          // ── Step 2: Role Selected ──
          if (i.isRoleSelectMenu() && i.customId === 'verify_setup_role_select') {
            selectedRoleId = i.values[0];

            const step3Embed = EmbedService.create(
              '⚙️ Setup Anti-Bot — Étape 3/3 : Confirmation',
              `Récapitulatif de la configuration :\n- **Salon captcha** : <#${selectedChannelId}>\n- **Rôle membre vérifié** : <@&${selectedRoleId}>\n\nEn cliquant sur **Activer la vérification**, le bot va :\n1. Créer ou identifier le rôle **Non vérifié**.\n2. Restreindre l'accès des nouveaux membres au seul salon captcha.\n3. Poster l'embed avec le bouton de vérification dans le salon choisi.`
            );

            const confirmBtn = new ButtonBuilder()
              .setCustomId('verify_setup_confirm_btn')
              .setLabel('Activer la vérification')
              .setStyle(ButtonStyle.Success)
              .setEmoji('⚡');

            const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn);

            await i.update({
              embeds: [step3Embed],
              components: [row3],
            });
            return;
          }

          // ── Step 3: Final Confirmation Button Clicked ──
          if (i.isButton() && i.customId === 'verify_setup_confirm_btn') {
            if (!selectedChannelId || !selectedRoleId) {
              await i.update({
                embeds: [EmbedService.error('Erreur', 'Données de configuration manquantes. Veuillez recommencer.')],
                components: [],
              });
              return;
            }

            await i.deferUpdate();

            // 1. Ensure Unverified Role
            const unverifiedRole = await VerifyService.ensureUnverifiedRole(guild);

            // 2. Configure Channel Permissions
            const { warnings } = await VerifyService.configureChannelPermissions(
              guild,
              selectedChannelId,
              unverifiedRole.id
            );

            // 3. Save Settings in DB
            await VerifyService.saveSettings({
              guildId: guild.id,
              verifyChannelId: selectedChannelId,
              verifiedRoleId: selectedRoleId,
              unverifiedRoleId: unverifiedRole.id,
              enabled: true,
            });

            // 4. Send Verification Embed in Captcha Channel
            const verifyChannel = guild.channels.cache.get(selectedChannelId);
            if (verifyChannel && verifyChannel instanceof TextChannel) {
              await VerifyService.sendVerificationEmbed(verifyChannel);
            }

            // 5. Final Confirmation Response
            let desc = `Le système de vérification anti-bot est désormais **actif** ! 🎉\n\n- **Salon Captcha** : <#${selectedChannelId}>\n- **Rôle Vérifié** : <@&${selectedRoleId}>\n- **Rôle Non Vérifié** : ${unverifiedRole}`;
            if (warnings.length > 0) {
              desc += `\n\n⚠️ **Avertissements** :\n${warnings.map((w) => `- ${w}`).join('\n')}`;
            }

            const successEmbed = EmbedService.success('Vérification configurée avec succès !', desc);

            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });

            collector.stop('completed');
          }
        } catch (err) {
          logger.error({ err }, 'Error during verify setup interactive flow');
          await interaction.followUp({
            embeds: [EmbedService.error('Erreur', 'Une erreur est survenue lors de la configuration.')],
            flags: 64, // Ephemeral
          }).catch(() => null);
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'completed') {
          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Temps écoulé',
                'La configuration interactive de la vérification a expiré. Veuillez relancer `/verify setup`.'
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
