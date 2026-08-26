import {
  Collection,
  Interaction,
  MessageFlags,
  TextChannel,
  VoiceChannel,
  UserSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Command } from '../types/command.js';
import { CooldownService } from '../services/cooldownService.js';
import { PermissionHandler } from '../utils/permissionHandler.js';
import { EmbedService } from '../services/embedService.js';
import { GiveawayService } from '../services/giveawayService.js';
import { TicketService } from '../services/ticketService.js';
import { VerifyService } from '../services/verifyService.js';
import { TempVoiceService } from '../services/tempVoiceService.js';
import { redis } from '../services/redisService.js';
import { logger } from '../utils/logger.js';

import { BlacklistService } from '../services/blacklistService.js';

export async function handleInteractionCreate(
  interaction: Interaction,
  commands: Collection<string, Command>
) {
  try {
    // 0. Centralized Blacklist Guard: Silently ignore blacklisted users or guilds
    const blacklist = await BlacklistService.isBlacklisted(interaction.user.id, interaction.guildId);
    if (blacklist.blacklisted) {
      return; // Silent ignore (no response)
    }

    // ─── TEMP VOICE BUTTON & MODAL INTERACTIONS ───────────────────────────

    if (interaction.isButton() && interaction.customId.startsWith('tempvoice_')) {
      const parts = interaction.customId.split(':');
      const action = parts[0];
      const channelId = parts[1];

      if (!channelId) return;

      const tempRecord = await TempVoiceService.getTempChannel(channelId);
      if (!tempRecord) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Ce salon vocal temporaire n\'existe plus.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return;
      }

      const guild = interaction.client.guilds.cache.get(tempRecord.guildId);
      if (!guild) return;

      const voiceChannel = guild.channels.cache.get(channelId);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Salon vocal introuvable.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return;
      }

      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      if (action === 'tempvoice_claim') {
        const res = await TempVoiceService.claimOwnership(guild, voiceChannel as VoiceChannel, member);
        if (res.success) {
          await interaction.reply({
            embeds: [EmbedService.success('Propriété réclamée ! 👑', `Vous êtes désormais le propriétaire du salon **${voiceChannel.name}** !`)],
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            embeds: [EmbedService.error('Erreur', 'Impossible de réclamer ce salon (le propriétaire actuel est présent ou vous n\'êtes pas dans le salon).')],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const isAllowed = await TempVoiceService.isOwnerOrStaff(guild, member, channelId);
      if (!isAllowed) {
        await interaction.reply({
          embeds: [EmbedService.error('Permission refusée', 'Seul le propriétaire de ce salon vocal ou un membre du staff peut utiliser ces commandes.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === 'tempvoice_lock') {
        await TempVoiceService.setLocked(voiceChannel as VoiceChannel, true);
        await interaction.reply({
          embeds: [EmbedService.success('Salon verrouillé 🔒', 'Le salon a été verrouillé.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === 'tempvoice_unlock') {
        await TempVoiceService.setLocked(voiceChannel as VoiceChannel, false);
        await interaction.reply({
          embeds: [EmbedService.success('Salon déverrouillé 🔓', 'Le salon est désormais ouvert.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === 'tempvoice_rename') {
        const modal = new ModalBuilder()
          .setCustomId(`tempvoice_rename_modal:${channelId}`)
          .setTitle('Renommer le salon vocal');

        const input = new TextInputBuilder()
          .setCustomId('tempvoice_name_input')
          .setLabel('Nouveau nom du salon')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Entrez le nouveau nom...')
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === 'tempvoice_limit') {
        const modal = new ModalBuilder()
          .setCustomId(`tempvoice_limit_modal:${channelId}`)
          .setTitle('Définir la limite de membres');

        const input = new TextInputBuilder()
          .setCustomId('tempvoice_limit_input')
          .setLabel('Limite (0 = illimité)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 5')
          .setRequired(true)
          .setMaxLength(2);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tempvoice_rename_modal:')) {
      const channelId = interaction.customId.split(':')[1];
      const newName = interaction.fields.getTextInputValue('tempvoice_name_input');

      const tempRecord = await TempVoiceService.getTempChannel(channelId);
      if (!tempRecord) return;

      const guild = interaction.client.guilds.cache.get(tempRecord.guildId);
      const voiceChannel = guild?.channels.cache.get(channelId);

      if (voiceChannel && voiceChannel.isVoiceBased()) {
        await TempVoiceService.renameChannel(voiceChannel as VoiceChannel, newName);
        await interaction.reply({
          embeds: [EmbedService.success('Salon renommé', `Nouveau nom : **${newName}**`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tempvoice_limit_modal:')) {
      const channelId = interaction.customId.split(':')[1];
      const rawLimit = interaction.fields.getTextInputValue('tempvoice_limit_input');
      const limit = parseInt(rawLimit, 10);

      if (isNaN(limit) || limit < 0 || limit > 99) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Veuillez saisir un nombre valide entre 0 et 99.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const tempRecord = await TempVoiceService.getTempChannel(channelId);
      if (!tempRecord) return;

      const guild = interaction.client.guilds.cache.get(tempRecord.guildId);
      const voiceChannel = guild?.channels.cache.get(channelId);

      if (voiceChannel && voiceChannel.isVoiceBased()) {
        await TempVoiceService.setLimit(voiceChannel as VoiceChannel, limit);
        await interaction.reply({
          embeds: [EmbedService.success('Limite mise à jour', limit === 0 ? 'Limite retirée (illimité).' : `Limite fixée à **${limit}** membres.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // ─── VERIFICATION INTERACTIONS ─────────────────────────────────────────

    // 1. Verify Start Button Click ("Se vérifier")
    if (interaction.isButton() && interaction.customId === 'verify_start') {
      if (!interaction.guild || !interaction.member) return;

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const settings = await VerifyService.getSettings(interaction.guild.id);
      if (!settings || !settings.enabled) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Le système de vérification n\'est pas actif sur ce serveur.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if already verified
      if (settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) {
        await interaction.reply({
          embeds: [EmbedService.warning('Déjà vérifié', 'Vous êtes déjà vérifié sur ce serveur !')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check Redis Cooldown
      const cooldownKey = `verify:cooldown:${interaction.guild.id}:${interaction.user.id}`;
      const ttl = await redis.ttl(cooldownKey);
      if (ttl > 0) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Cooldown actif ⏳',
              `Vous avez atteint la limite de tentatives échouées. Veuillez patienter \`${ttl}s\` avant de pouvoir réinteragir.`
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Generate Captcha
      const { promptText } = await VerifyService.generateCaptcha(interaction.guild.id, interaction.user.id);

      const embed = EmbedService.create(
        '🛡️ Contrôle Anti-Bot — Captcha',
        `Veuillez répondre au captcha ci-dessous :\n\n${promptText}\n\n*Cliquez sur le bouton ci-dessous pour ouvrir le formulaire et saisir votre réponse.*`
      );

      const modalBtn = new ButtonBuilder()
        .setCustomId('verify_open_modal')
        .setLabel('Saisir la réponse')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(modalBtn);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Open Verification Modal Button Click
    if (interaction.isButton() && interaction.customId === 'verify_open_modal') {
      const modal = new ModalBuilder()
        .setCustomId('verify_modal_submit')
        .setTitle('Vérification Anti-Bot');

      const input = new TextInputBuilder()
        .setCustomId('verify_input_code')
        .setLabel('Code captcha ou réponse')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Entrez le code ou la réponse ici...')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20);

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // 3. Modal Submit Handler
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal_submit') {
      if (!interaction.guild || !interaction.member) return;

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const userInput = interaction.fields.getTextInputValue('verify_input_code');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await VerifyService.verifyAnswer(interaction.guild, member, userInput);

      if (result.success) {
        await interaction.editReply({
          embeds: [
            EmbedService.success(
              'Vérification réussie ! 🎉',
              'Vous avez été vérifié avec succès. Vous avez désormais accès à l\'ensemble du serveur !'
            ),
          ],
        });
      } else {
        if (result.reason === 'cooldown') {
          await interaction.editReply({
            embeds: [
              EmbedService.error(
                'Cooldown actif ⏳',
                `Limite de tentatives atteinte. Veuillez patienter \`${result.remainingSeconds}s\` avant de réessayer.`
              ),
            ],
          });
        } else if (result.reason === 'expired') {
          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Captcha expiré ⏱️',
                'Le captcha a expiré. Veuillez relancer la vérification en cliquant sur **Se vérifier**.'
              ),
            ],
          });
        } else if (result.onCooldown) {
          await interaction.editReply({
            embeds: [
              EmbedService.error(
                'Code incorrect ❌',
                `Nombre maximal d'essais (${result.maxAttempts}) atteint ! Un cooldown de \`${result.remainingSeconds}s\` a été appliqué.`
              ),
            ],
          });
        } else {
          // Incorrect attempt, generate new captcha for next try
          await VerifyService.generateCaptcha(interaction.guild.id, interaction.user.id);

          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Code incorrect ❌',
                `Réponse incorrecte (Essai ${result.attempts}/${result.maxAttempts}).\nUn nouveau captcha a été généré. Cliquez à nouveau sur **Se vérifier** pour tenter votre chance.`
              ),
            ],
          });
        }
      }
      return;
    }
    // Handle Reaction Role Button Click
    if (interaction.isButton() && interaction.customId.startsWith('role_btn_')) {
      const roleId = interaction.customId.replace('role_btn_', '');
      const guild = interaction.guild;
      if (!guild || !interaction.member) return;

      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      const role = guild.roles.cache.get(roleId);

      if (!member || !role) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Rôle introuvable ou vous n êtes pas membre de ce serveur.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return;
      }

      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role).catch(() => null);
        await interaction.reply({
          embeds: [EmbedService.warning('Rôle retiré', `Le rôle **${role.name}** vous a été retiré.`)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      } else {
        await member.roles.add(role).catch(() => null);
        await interaction.reply({
          embeds: [EmbedService.success('Rôle attribué', `Le rôle **${role.name}** vous a été attribué !`)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
      return;
    }

    // Handle Giveaway Join Button Click
    if (interaction.isButton() && interaction.customId.startsWith('gw_join_')) {
      const giveawayId = interaction.customId.replace('gw_join_', '');
      if (!interaction.guild || !interaction.member) return;

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const { joined, reason } = await GiveawayService.toggleEntry(giveawayId, member);

      if (reason) {
        await interaction.reply({
          embeds: [EmbedService.error('Participation refusée', reason)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return;
      }

      if (joined) {
        await interaction.reply({
          embeds: [EmbedService.success('Participation enregistrée !', 'Votre participation à ce concours a été validée 🎉')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      } else {
        await interaction.reply({
          embeds: [EmbedService.warning('Participation retirée', 'Vous ne participez plus à ce concours.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
      return;
    }

    // ─── TICKET INTERACTIONS ──────────────────────────────────────────────

    // 1. Open Ticket Button Click
    if (interaction.isButton() && interaction.customId.startsWith('ticket_create_default')) {
      if (!interaction.guild || !interaction.member) return;
      const type = interaction.customId.split(':')[1] || 'Support';

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const res = await TicketService.openTicket(interaction.guild, member, type);

      if (!res.success) {
        if (res.reason === 'limit_reached') {
          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Limite de tickets atteinte',
                `Vous avez déjà **${res.limit} ticket(s)** ouvert(s) sur ce serveur. Veuillez le(s) fermer avant d'en ouvrir un nouveau.`
              ),
            ],
          });
          return;
        }

        await interaction.editReply({
          embeds: [EmbedService.error('Erreur', 'Impossible d\'ouvrir un ticket pour le moment.')],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          EmbedService.success(
            'Ticket créé !',
            `Votre ticket a été ouvert avec succès : ${res.channel}`
          ),
        ],
      });
      return;
    }

    // 2. Open Ticket Select Menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_create_select') {
      if (!interaction.guild || !interaction.member) return;
      const selectedType = interaction.values[0] || 'Support';

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const res = await TicketService.openTicket(interaction.guild, member, selectedType);

      if (!res.success) {
        if (res.reason === 'limit_reached') {
          await interaction.editReply({
            embeds: [
              EmbedService.warning(
                'Limite de tickets atteinte',
                `Vous avez déjà **${res.limit} ticket(s)** ouvert(s) sur ce serveur. Veuillez le(s) fermer avant d'en ouvrir un nouveau.`
              ),
            ],
          });
          return;
        }

        await interaction.editReply({
          embeds: [EmbedService.error('Erreur', 'Impossible d\'ouvrir un ticket pour le moment.')],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          EmbedService.success(
            'Ticket créé !',
            `Votre ticket **${selectedType}** a été créé : ${res.channel}`
          ),
        ],
      });
      return;
    }

    // 3. Ticket Button Actions inside Channel (Fermer, Réclamer, Ajouter un membre)
    if (interaction.isButton() && interaction.customId.startsWith('ticket_close:')) {
      if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const res = await TicketService.closeTicket(
        interaction.channel,
        member,
        'Fermeture via le bouton'
      );

      if (!res.success) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Fermeture impossible',
              res.reason === 'unauthorized'
                ? 'Seul le propriétaire du ticket ou un membre staff peut fermer ce ticket.'
                : 'Erreur lors de la fermeture du ticket.'
            ),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_claim:')) {
      if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;

      const res = await TicketService.claimTicket(interaction.channel, member);

      if (!res.success) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Réclamation impossible',
              res.reason === 'already_claimed'
                ? 'Ce ticket est déjà réclamé par un membre du staff.'
                : res.reason === 'unauthorized'
                ? 'Seul un membre du staff peut réclamer ce ticket.'
                : 'Erreur lors de la réclamation.'
            ),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      } else {
        await interaction.reply({
          embeds: [EmbedService.success('Ticket réclamé', `Vous avez pris en charge ce ticket.`)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_add_member:')) {
      if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;

      const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('ticket_user_select_add')
        .setPlaceholder('Sélectionnez un membre à ajouter au salon...');

      const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selectMenu);

      await interaction.reply({
        content: 'Veuillez sélectionner le membre à ajouter à ce ticket :',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'ticket_user_select_add') {
      if (!interaction.guild || !(interaction.channel instanceof TextChannel)) return;
      const targetUserId = interaction.values[0];
      if (!targetUserId) return;

      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      const executorMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

      if (!targetMember || !executorMember) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Membre introuvable.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = await TicketService.addMemberToTicket(
        interaction.channel,
        targetMember,
        executorMember
      );

      if (res.success) {
        await interaction.reply({
          embeds: [EmbedService.success('Membre ajouté', `${targetMember} a été ajouté avec succès au ticket.`)],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', 'Impossible d\'ajouter ce membre au ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`[COMMAND] No matching command found for /${interaction.commandName}`);
      return;
    }

    // 1. Permission check (User)
    if (command.userPermissions && command.userPermissions.length > 0) {
      const hasPerms = await PermissionHandler.checkUserPermissions(
        interaction,
        command.userPermissions
      );
      if (!hasPerms) return;
    }

    // 2. Permission check (Bot)
    if (command.botPermissions && command.botPermissions.length > 0) {
      const botHasPerms = await PermissionHandler.checkBotPermissions(
        interaction,
        command.botPermissions
      );
      if (!botHasPerms) return;
    }

    // 3. Cooldown check
    const cooldownTime = command.cooldown || 3;
    const cooldownKey = `cooldown:${interaction.user.id}:${command.data.name}`;
    const { onCooldown, remainingSeconds } = await CooldownService.checkCooldown(
      cooldownKey,
      cooldownTime
    );

    if (onCooldown) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Veuillez patienter',
            `Cette commande est en rechargement. Réessayez dans \`${remainingSeconds}s\`.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return;
    }

    // Set cooldown
    await CooldownService.setCooldown(cooldownKey, cooldownTime);

    // 4. Execution
    try {
      await command.execute(interaction);
    } catch (error: any) {
      const errName = error?.name || '';
      const errCode = error?.code || '';

      if (errCode === 'UND_ERR_CONNECT_TIMEOUT' || errName === 'ConnectTimeoutError') {
        logger.warn(`[NETWORK TIMEOUT] Connection to Discord API timed out while executing /${command.data.name}`);
      } else {
        logger.error({ err: error, command: command.data.name }, `[COMMAND ERROR] Error executing /${command.data.name}`);
      }

      const errorEmbed = EmbedService.error(
        'Erreur de commande',
        'Une erreur ou un délai de réseau est survenu lors de l exécution de cette commande.'
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
  } catch (globalError: any) {
    const errCode = globalError?.code || '';
    if (errCode === 'UND_ERR_CONNECT_TIMEOUT') {
      logger.warn('[NETWORK TIMEOUT] Discord API connection timeout in global interaction handler');
    } else {
      logger.error({ err: globalError }, '[INTERACTION ERROR] Unhandled exception in interaction listener');
    }
  }
}
