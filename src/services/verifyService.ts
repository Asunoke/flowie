import {
  Guild,
  GuildMember,
  TextChannel,
  Role,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  User,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { redis } from './redisService.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';

export interface VerifyCaptchaResult {
  captchaText: string;
  type: 'text' | 'math';
}

export class VerifyService {
  /**
   * Retrieves VerifySettings from DB for a given guild
   */
  static async getSettings(guildId: string) {
    return prisma.verifySettings.findUnique({
      where: { guildId },
    });
  }

  /**
   * Saves or updates VerifySettings in DB
   */
  static async saveSettings(data: {
    guildId: string;
    verifyChannelId: string;
    verifiedRoleId: string;
    unverifiedRoleId: string;
    enabled: boolean;
  }) {
    return prisma.verifySettings.upsert({
      where: { guildId: data.guildId },
      create: {
        guildId: data.guildId,
        verifyChannelId: data.verifyChannelId,
        verifiedRoleId: data.verifiedRoleId,
        unverifiedRoleId: data.unverifiedRoleId,
        enabled: data.enabled,
      },
      update: {
        verifyChannelId: data.verifyChannelId,
        verifiedRoleId: data.verifiedRoleId,
        unverifiedRoleId: data.unverifiedRoleId,
        enabled: data.enabled,
      },
    });
  }

  /**
   * Disables verification for a guild without deleting roles/channels
   */
  static async disableVerification(guildId: string) {
    const settings = await this.getSettings(guildId);
    if (!settings) return null;

    return prisma.verifySettings.update({
      where: { guildId },
      data: { enabled: false },
    });
  }

  /**
   * Finds existing "Non vérifié" / "Suspect" role or creates a new one
   */
  static async ensureUnverifiedRole(guild: Guild): Promise<Role> {
    let role = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === 'non vérifié' || r.name.toLowerCase() === 'suspect'
    );

    if (!role) {
      role = await guild.roles.create({
        name: 'Non vérifié',
        color: 0x7f8c8d, // Muted grey
        permissions: [],
        reason: 'Rôle automatique pour les membres non vérifiés (Flowie Anti-Bot)',
      });
    }

    return role;
  }

  /**
   * Configures channel permissions for the unverified role.
   * - Verify channel: ViewChannel = true, SendMessages = true
   * - Other channels: ViewChannel = false
   */
  static async configureChannelPermissions(
    guild: Guild,
    verifyChannelId: string,
    unverifiedRoleId: string
  ): Promise<{ success: boolean; warnings: string[] }> {
    const warnings: string[] = [];

    // 1. Fetch channel and role
    const verifyChannel = guild.channels.cache.get(verifyChannelId);
    const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);

    if (!verifyChannel || !unverifiedRole) {
      return { success: false, warnings: ['Salon captcha ou rôle introuvable.'] };
    }

    // 2. Allow access in verify channel
    try {
      if ('permissionOverwrites' in verifyChannel) {
        await verifyChannel.permissionOverwrites.edit(unverifiedRole, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }
    } catch (err: any) {
      logger.warn({ err }, `Failed to update permissions for verify channel ${verifyChannelId}`);
      warnings.push(`Impossible de modifier les permissions du salon captcha ${verifyChannel.name}.`);
    }

    // 3. Deny access in other channels
    let failedChannelsCount = 0;
    for (const [, channel] of guild.channels.cache) {
      if (channel.id === verifyChannelId) continue;
      if (!('permissionOverwrites' in channel)) continue;

      try {
        await channel.permissionOverwrites.edit(unverifiedRole, {
          ViewChannel: false,
        });
      } catch (err) {
        failedChannelsCount++;
      }
    }

    if (failedChannelsCount > 0) {
      warnings.push(
        `Des déni d'accès ont échoué sur ${failedChannelsCount} salon(s). Veuillez vérifier manuellement les permissions.`
      );
    }

    return { success: true, warnings };
  }

  /**
   * Posts permanent verification message in the captcha channel
   */
  static async sendVerificationEmbed(channel: TextChannel) {
    const embed = EmbedService.create(
      '🛡️ Vérification Anti-Bot',
      'Bienvenue sur le serveur !\n\nPour accéder à l\'ensemble des salons, veuillez valider le contrôle anti-bot en cliquant sur le bouton **Se vérifier** ci-dessous.'
    ).addFields({
      name: '❓ Comment ça marche ?',
      value: '1️⃣ Cliquez sur **Se vérifier**.\n2️⃣ Un code captcha unique vous sera affiché.\n3️⃣ Saisissez le code dans la fenêtre modale pour débloquer votre accès.',
    });

    const button = new ButtonBuilder()
      .setCustomId('verify_start')
      .setLabel('Se vérifier')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🛡️');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await channel.send({ embeds: [embed], components: [row] });
  }

  /**
   * Generates a captcha code (math question or alphanumeric text) and stores it in Redis (5 min TTL)
   */
  static async generateCaptcha(
    guildId: string,
    userId: string
  ): Promise<{ promptText: string; expectedAnswer: string }> {
    const isMath = Math.random() > 0.5;
    let promptText = '';
    let expectedAnswer = '';

    if (isMath) {
      const num1 = Math.floor(Math.random() * 20) + 1;
      const num2 = Math.floor(Math.random() * 20) + 1;
      const sum = num1 + num2;
      promptText = `Résolvez l'opération : **${num1} + ${num2} = ?**`;
      expectedAnswer = sum.toString();
    } else {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      promptText = `Recopiez le code captcha suivant : **\`${code}\`**`;
      expectedAnswer = code;
    }

    const captchaKey = `verify:captcha:${guildId}:${userId}`;
    await redis.set(captchaKey, expectedAnswer, 'EX', 300); // 5 minutes TTL

    return { promptText, expectedAnswer };
  }

  /**
   * Verifies the user's captcha answer
   */
  static async verifyAnswer(
    guild: Guild,
    member: GuildMember,
    userInput: string
  ): Promise<{
    success: boolean;
    reason?: 'cooldown' | 'expired' | 'incorrect' | 'role_error';
    remainingSeconds?: number;
    attempts?: number;
    maxAttempts?: number;
    onCooldown?: boolean;
  }> {
    const guildId = guild.id;
    const userId = member.id;

    // 1. Check Redis Cooldown
    const cooldownKey = `verify:cooldown:${guildId}:${userId}`;
    const ttl = await redis.ttl(cooldownKey);
    if (ttl > 0) {
      return { success: false, reason: 'cooldown', remainingSeconds: ttl };
    }

    // 2. Fetch expected answer from Redis
    const captchaKey = `verify:captcha:${guildId}:${userId}`;
    const expectedAnswer = await redis.get(captchaKey);

    if (!expectedAnswer) {
      return { success: false, reason: 'expired' };
    }

    const normalizedInput = userInput.trim().toUpperCase();
    const normalizedExpected = expectedAnswer.trim().toUpperCase();

    const attemptsKey = `verify:attempts:${guildId}:${userId}`;

    if (normalizedInput === normalizedExpected) {
      // Correct answer!
      await redis.del(captchaKey);
      await redis.del(attemptsKey);

      const settings = await this.getSettings(guildId);
      if (settings) {
        // Remove unverified role
        if (settings.unverifiedRoleId && member.roles.cache.has(settings.unverifiedRoleId)) {
          await member.roles.remove(settings.unverifiedRoleId).catch((err) => {
            logger.error({ err }, `Failed to remove unverified role ${settings.unverifiedRoleId} from ${member.user.tag}`);
          });
        }

        // Add verified role
        if (settings.verifiedRoleId) {
          const verifiedRole = guild.roles.cache.get(settings.verifiedRoleId);
          if (verifiedRole) {
            await member.roles.add(verifiedRole).catch((err) => {
              logger.error({ err }, `Failed to add verified role ${settings.verifiedRoleId} to ${member.user.tag}`);
            });
          }
        }
      }

      // Log verification success
      await this.logVerification(guild, member.user, true);

      return { success: true };
    } else {
      // Incorrect answer!
      const rawAttempts = await redis.get(attemptsKey);
      const currentAttempts = (rawAttempts ? parseInt(rawAttempts, 10) : 0) + 1;
      const maxAttempts = 5;

      if (currentAttempts >= maxAttempts) {
        // Trigger 60s cooldown
        await redis.set(cooldownKey, '1', 'EX', 60);
        await redis.del(attemptsKey);
        await redis.del(captchaKey);

        // Log cooldown triggered
        await this.logVerification(guild, member.user, false, 'Limite de 5 tentatives atteinte (cooldown 1 min)');

        return {
          success: false,
          reason: 'incorrect',
          attempts: currentAttempts,
          maxAttempts,
          onCooldown: true,
          remainingSeconds: 60,
        };
      } else {
        await redis.set(attemptsKey, currentAttempts.toString(), 'EX', 600); // 10 min window

        // Log failed attempt
        await this.logVerification(guild, member.user, false, `Tentative ${currentAttempts}/${maxAttempts} échouée`);

        return {
          success: false,
          reason: 'incorrect',
          attempts: currentAttempts,
          maxAttempts,
          onCooldown: false,
        };
      }
    }
  }

  /**
   * Logs verification success/failure to the server log channel
   */
  static async logVerification(
    guild: Guild,
    user: User,
    success: boolean,
    details?: string
  ) {
    try {
      const guildConfig = await prisma.guild.findUnique({
        where: { id: guild.id },
      });

      if (!guildConfig || !guildConfig.logChannelId) return;

      const logChannel = guild.channels.cache.get(guildConfig.logChannelId);
      if (!logChannel || !(logChannel instanceof TextChannel)) return;

      const embed = success
        ? EmbedService.success(
            '🛡️ Vérification réussie',
            `Le membre **${user.tag}** (${user.id}) s'est vérifié avec succès.`
          )
        : EmbedService.error(
            '🚨 Échec de vérification Anti-Bot',
            `Le membre **${user.tag}** (${user.id}) a échoué le captcha.\nDétail : ${details || 'Code incorrect'}`
          );

      embed.setThumbnail(user.displayAvatarURL());
      embed.setTimestamp();

      await logChannel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      logger.error({ err }, 'Error logging verification result');
    }
  }
}
