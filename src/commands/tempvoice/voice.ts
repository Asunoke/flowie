import {
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { TempVoiceService } from '../../services/tempVoiceService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Commandes de contrôle de votre salon vocal temporaire')
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Renommer votre salon vocal temporaire')
        .addStringOption((opt) =>
          opt.setName('nom').setDescription('Nouveau nom du salon').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Définir la limite de membres autorisés dans le salon (0 = illimité)')
        .addIntegerOption((opt) =>
          opt
            .setName('nombre')
            .setDescription('Nombre de membres max (0 à 99)')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('lock').setDescription('Verrouiller le salon (empêcher les connexions sans invitation)')
    )
    .addSubcommand((sub) =>
      sub.setName('unlock').setDescription('Déverrouiller le salon (autoriser les connexions)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Expulser un membre de votre salon vocal temporaire')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le membre à expulser').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('permit')
        .setDescription('Autoriser explicitement un membre à rejoindre le salon')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le membre à autoriser').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reject')
        .setDescription('Bloquer et expulser un membre de votre salon')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le membre à bloquer').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Transférer la propriété du salon à un autre membre présent')
        .addUserOption((opt) =>
          opt.setName('membre').setDescription('Le nouveau propriétaire').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('claim')
        .setDescription('Réclamer la propriété du salon si le propriétaire a quitté')
    ),
  category: 'tempvoice',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return;

    const executorMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!executorMember) return;

    const voiceChannelState = executorMember.voice.channel;
    if (!voiceChannelState || !(voiceChannelState instanceof VoiceChannel)) {
      await interaction.reply({
        embeds: [EmbedService.warning('Action impossible', 'Vous devez être connecté dans votre salon vocal temporaire pour utiliser cette commande.')],
        flags: 64,
      });
      return;
    }

    const voiceChannel = voiceChannelState as VoiceChannel;
    const subcommand = interaction.options.getSubcommand();

    // ── Special Case: CLAIM ────────────────────────────────────────────────
    if (subcommand === 'claim') {
      const res = await TempVoiceService.claimOwnership(interaction.guild, voiceChannel, executorMember);
      if (res.success) {
        await interaction.reply({
          embeds: [EmbedService.success('Propriété réclamée ! 👑', `Vous êtes désormais le propriétaire du salon vocal **${voiceChannel.name}** !`)],
        });
      } else {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Réclamation impossible',
              res.reason === 'already_owner'
                ? 'Vous êtes déjà le propriétaire de ce salon vocal.'
                : 'Le propriétaire actuel est toujours présent dans le salon vocal.'
            ),
          ],
          flags: 64,
        });
      }
      return;
    }

    // ── Ownership Guard for all other subcommands ─────────────────────────
    const isAllowed = await TempVoiceService.isOwnerOrStaff(interaction.guild, executorMember, voiceChannel.id);
    if (!isAllowed) {
      await interaction.reply({
        embeds: [EmbedService.error('Permission refusée', 'Seul le propriétaire de ce salon vocal ou un membre du staff peut utiliser ces commandes.')],
        flags: 64,
      });
      return;
    }

    // ── Subcommand: RENAME ─────────────────────────────────────────────────
    if (subcommand === 'rename') {
      const newName = interaction.options.getString('nom', true);
      await TempVoiceService.renameChannel(voiceChannel, newName);
      await interaction.reply({
        embeds: [EmbedService.success('Salon renommé', `Le salon a été renommé en **${newName}**.`)] ,
      });
      return;
    }

    // ── Subcommand: LIMIT ──────────────────────────────────────────────────
    if (subcommand === 'limit') {
      const limit = interaction.options.getInteger('nombre', true);
      await TempVoiceService.setLimit(voiceChannel, limit);
      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Limite de membres mise à jour',
            limit === 0
              ? 'La limite de membres a été retirée (illimité).'
              : `La limite de membres a été définie à **${limit}**.`
          ),
        ],
      });
      return;
    }

    // ── Subcommand: LOCK ───────────────────────────────────────────────────
    if (subcommand === 'lock') {
      await TempVoiceService.setLocked(voiceChannel, true);
      await interaction.reply({
        embeds: [EmbedService.success('Salon verrouillé 🔒', 'Le salon a été verrouillé. Les autres membres ne peuvent plus le rejoindre sans autorisation.')],
      });
      return;
    }

    // ── Subcommand: UNLOCK ─────────────────────────────────────────────────
    if (subcommand === 'unlock') {
      await TempVoiceService.setLocked(voiceChannel, false);
      await interaction.reply({
        embeds: [EmbedService.success('Salon déverrouillé 🔓', 'Le salon est désormais accessible à tous.')],
      });
      return;
    }

    // ── Subcommand: KICK ───────────────────────────────────────────────────
    if (subcommand === 'kick') {
      const targetUser = interaction.options.getUser('membre', true);
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) {
        await interaction.reply({ embeds: [EmbedService.error('Erreur', 'Membre introuvable.')], flags: 64 });
        return;
      }

      await TempVoiceService.kickMember(voiceChannel, targetMember);
      await interaction.reply({
        embeds: [EmbedService.success('Membre expulsé', `${targetMember} a été expulsé de votre salon vocal.`)],
      });
      return;
    }

    // ── Subcommand: PERMIT ─────────────────────────────────────────────────
    if (subcommand === 'permit') {
      const targetUser = interaction.options.getUser('membre', true);
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) {
        await interaction.reply({ embeds: [EmbedService.error('Erreur', 'Membre introuvable.')], flags: 64 });
        return;
      }

      await TempVoiceService.permitMember(voiceChannel, targetMember);
      await interaction.reply({
        embeds: [EmbedService.success('Membre autorisé', `${targetMember} a été autorisé à rejoindre votre salon.`)],
      });
      return;
    }

    // ── Subcommand: REJECT ─────────────────────────────────────────────────
    if (subcommand === 'reject') {
      const targetUser = interaction.options.getUser('membre', true);
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) {
        await interaction.reply({ embeds: [EmbedService.error('Erreur', 'Membre introuvable.')], flags: 64 });
        return;
      }

      await TempVoiceService.rejectMember(voiceChannel, targetMember);
      await interaction.reply({
        embeds: [EmbedService.success('Membre bloqué', `${targetMember} a été bloqué et expulsé de votre salon.`)],
      });
      return;
    }

    // ── Subcommand: TRANSFER ───────────────────────────────────────────────
    if (subcommand === 'transfer') {
      const targetUser = interaction.options.getUser('membre', true);
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) {
        await interaction.reply({ embeds: [EmbedService.error('Erreur', 'Membre introuvable.')], flags: 64 });
        return;
      }

      if (targetMember.voice.channelId !== voiceChannel.id) {
        await interaction.reply({
          embeds: [EmbedService.warning('Transfert impossible', 'Le membre doit être présent dans le salon vocal pour recevoir la propriété.')],
          flags: 64,
        });
        return;
      }

      await TempVoiceService.transferOwnership(interaction.guild, voiceChannel, targetMember);
      await interaction.reply({
        embeds: [EmbedService.success('Propriété transférée 👑', `${targetMember} est désormais le propriétaire de ce salon vocal.`)],
      });
      return;
    }
  },
};

export default command;
