import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';

export class GiveawayService {
  private static activeTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Start a new giveaway
   */
  static async createGiveaway(
    client: Client,
    guildId: string,
    channelId: string,
    hostId: string,
    prize: string,
    winnersCount: number,
    durationMinutes: number,
    requiredRoleId?: string
  ) {
    const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    const giveaway = await prisma.giveaway.create({
      data: {
        guildId,
        channelId,
        hostId,
        prize,
        winnersCount,
        requiredRoleId,
        endsAt,
      },
    });

    const channel = (await client.channels.fetch(channelId).catch(() => null)) as TextChannel;
    if (!channel) return null;

    const timestamp = Math.floor(endsAt.getTime() / 1000);

    const embed = EmbedService.gold(
      `🎉 CONCOURS : ${prize}`,
      `Cliquez sur le bouton ci-dessous pour participer !\n\n` +
        `**Gagnant(s)** : \`${winnersCount}\`\n` +
        `**Organisateur** : <@${hostId}>\n` +
        `**Fin du concours** : <t:${timestamp}:R> (<t:${timestamp}:F>)\n` +
        `${requiredRoleId ? `**Rôle requis** : <@&${requiredRoleId}>\n` : ''}`
    );

    const joinButton = new ButtonBuilder()
      .setCustomId(`gw_join_${giveaway.id}`)
      .setLabel('Participer 🎉')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton);

    const message = await channel.send({ embeds: [embed], components: [row] });

    await prisma.giveaway.update({
      where: { id: giveaway.id },
      data: { messageId: message.id },
    });

    this.scheduleTimer(client, giveaway.id, endsAt.getTime() - Date.now());

    return giveaway;
  }

  /**
   * Schedule timeout timer for giveaway ending
   */
  private static scheduleTimer(client: Client, giveawayId: string, delayMs: number) {
    if (this.activeTimers.has(giveawayId)) {
      clearTimeout(this.activeTimers.get(giveawayId)!);
    }

    const timer = setTimeout(() => {
      this.endGiveaway(client, giveawayId);
    }, Math.max(delayMs, 1000));

    this.activeTimers.set(giveawayId, timer);
  }

  /**
   * Toggle user participation in giveaway
   */
  static async toggleEntry(giveawayId: string, member: GuildMember): Promise<{ joined: boolean; reason?: string }> {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway || giveaway.ended) {
      return { joined: false, reason: 'Ce concours est terminé ou invalide.' };
    }

    // Role check if configured
    if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
      return { joined: false, reason: `Vous devez posséder le rôle <@&${giveaway.requiredRoleId}> pour participer.` };
    }

    const existing = await prisma.giveawayEntry.findUnique({
      where: { giveawayId_userId: { giveawayId, userId: member.id } },
    });

    if (existing) {
      await prisma.giveawayEntry.delete({ where: { id: existing.id } });
      return { joined: false };
    } else {
      await prisma.giveawayEntry.create({
        data: {
          giveawayId,
          guildId: giveaway.guildId,
          userId: member.id,
        },
      });
      return { joined: true };
    }
  }

  /**
   * Conclude a giveaway & pick random winner(s)
   */
  static async endGiveaway(client: Client, giveawayId: string) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: { entries: true },
    });

    if (!giveaway || giveaway.ended) return;

    const winners = this.pickWinners(giveaway.entries.map((e: { userId: string }) => e.userId), giveaway.winnersCount);

    await prisma.giveaway.update({
      where: { id: giveawayId },
      data: {
        ended: true,
        winners,
      },
    });

    const channel = (await client.channels.fetch(giveaway.channelId).catch(() => null)) as TextChannel;
    if (!channel) return;

    if (giveaway.messageId) {
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (message) {
        const disabledButton = new ButtonBuilder()
          .setCustomId(`gw_join_${giveawayId}`)
          .setLabel('Concours Terminé 🔒')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);
        await message.edit({ components: [row] }).catch(() => null);
      }
    }

    if (winners.length === 0) {
      const embed = EmbedService.warning(
        `🎉 Concours Terminé : ${giveaway.prize}`,
        `Malheureusement, aucun participant valide n a été enregistré.`
      );
      await channel.send({ embeds: [embed] });
    } else {
      const winnerMentions = winners.map((w) => `<@${w}>`).join(', ');
      const embed = EmbedService.success(
        `🎉 CONCOURS TERMINÉ : ${giveaway.prize}`,
        `Félicitations à ${winnerMentions} qui remporte(nt) **${giveaway.prize}** !`
      );
      await channel.send({ content: `🎉 Félicitations ${winnerMentions} !`, embeds: [embed] });
    }
  }

  /**
   * Reroll new winner(s) for an ended giveaway
   */
  static async rerollGiveaway(client: Client, giveawayId: string) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: { entries: true },
    });

    if (!giveaway || !giveaway.ended) return null;

    const winners = this.pickWinners(giveaway.entries.map((e: { userId: string }) => e.userId), giveaway.winnersCount);

    await prisma.giveaway.update({
      where: { id: giveawayId },
      data: { winners },
    });

    const channel = (await client.channels.fetch(giveaway.channelId).catch(() => null)) as TextChannel;
    if (channel && winners.length > 0) {
      const winnerMentions = winners.map((w) => `<@${w}>`).join(', ');
      const embed = EmbedService.gold(
        `🔄 Nouveau Tirage Au Sort : ${giveaway.prize}`,
        `Nouveau(x) gagnant(s) : ${winnerMentions} !`
      );
      await channel.send({ content: `🎉 Nouveau(x) gagnant(s) : ${winnerMentions} !`, embeds: [embed] });
    }

    return winners;
  }

  /**
   * Restore active giveaways on bot startup
   */
  static async restoreGiveaways(client: Client) {
    const activeGiveaways = await prisma.giveaway.findMany({
      where: { ended: false },
    });

    logger.info(`[GIVEAWAYS] Restoring ${activeGiveaways.length} active giveaways from DB...`);

    for (const gw of activeGiveaways) {
      const remainingMs = new Date(gw.endsAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        await this.endGiveaway(client, gw.id);
      } else {
        this.scheduleTimer(client, gw.id, remainingMs);
      }
    }
  }

  private static pickWinners(users: string[], count: number): string[] {
    if (users.length === 0) return [];
    const shuffled = [...users].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, users.length));
  }
}
