import {
  Collection,
  Interaction,
  MessageFlags,
  TextChannel,
  UserSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js';
import { Command } from '../types/command.js';
import { CooldownService } from '../services/cooldownService.js';
import { PermissionHandler } from '../utils/permissionHandler.js';
import { EmbedService } from '../services/embedService.js';
import { GiveawayService } from '../services/giveawayService.js';
import { TicketService } from '../services/ticketService.js';
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
