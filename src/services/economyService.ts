import { prisma } from '../database/db.js';
import { config } from '../config/index.js';

export interface DailyClaimResult {
  amount: number;
  streak: number;
  bonus: number;
}

export class EconomyService {
  /**
   * Fetch member or create default record with 100 base Flow
   */
  static async getMember(guildId: string, userId: string) {
    let member = await prisma.member.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    if (!member) {
      await prisma.guild.upsert({
        where: { id: guildId },
        create: { id: guildId },
        update: {},
      });

      member = await prisma.member.create({
        data: { guildId, userId, balance: 100 },
      });
    }

    return member;
  }

  /**
   * Get guild currency name (defaults to "Flow")
   */
  static async getCurrencyName(guildId: string): Promise<string> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    return guild?.currencyName || config.economy.defaultCurrency || 'Flow';
  }

  /**
   * Add money to wallet balance & record transaction
   */
  static async addBalance(
    guildId: string,
    userId: string,
    amount: number,
    type: string,
    description: string
  ) {
    const member = await this.getMember(guildId, userId);

    const updated = await prisma.member.update({
      where: { id: member.id },
      data: { balance: { increment: amount } },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type,
        amount,
        description,
      },
    });

    return updated;
  }

  /**
   * Remove money from wallet balance if sufficient funds exist
   */
  static async removeBalance(
    guildId: string,
    userId: string,
    amount: number,
    type: string,
    description: string
  ): Promise<boolean> {
    const member = await this.getMember(guildId, userId);

    if (member.balance < amount) return false;

    await prisma.member.update({
      where: { id: member.id },
      data: { balance: { decrement: amount } },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type,
        amount: -amount,
        description,
      },
    });

    return true;
  }

  /**
   * Claim daily reward with streak bonus
   */
  static async claimDaily(guildId: string, userId: string): Promise<{ success: boolean; result?: DailyClaimResult; nextAvailableAt?: Date }> {
    const member = await this.getMember(guildId, userId);
    const now = new Date();

    if (member.lastDaily) {
      const msDiff = now.getTime() - new Date(member.lastDaily).getTime();
      const hoursDiff = msDiff / (1000 * 60 * 60);

      if (hoursDiff < 24) {
        const nextAvailableAt = new Date(new Date(member.lastDaily).getTime() + 24 * 60 * 60 * 1000);
        return { success: false, nextAvailableAt };
      }
    }

    // Determine streak continuity (broken if > 48 hours)
    let newStreak = member.dailyStreak + 1;
    if (member.lastDaily) {
      const msDiff = now.getTime() - new Date(member.lastDaily).getTime();
      const hoursDiff = msDiff / (1000 * 60 * 60);
      if (hoursDiff > 48) {
        newStreak = 1;
      }
    }

    const baseReward = 200;
    const streakBonus = Math.min(newStreak * 20, 300);
    const totalAmount = baseReward + streakBonus;

    await prisma.member.update({
      where: { id: member.id },
      data: {
        balance: { increment: totalAmount },
        dailyStreak: newStreak,
        lastDaily: now,
      },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type: 'DAILY',
        amount: totalAmount,
        description: `Récompense quotidienne (Série de ${newStreak} jour(s))`,
      },
    });

    return {
      success: true,
      result: {
        amount: totalAmount,
        streak: newStreak,
        bonus: streakBonus,
      },
    };
  }

  /**
   * Work job action with random earning and 1 hour cooldown
   */
  static async doWork(guildId: string, userId: string): Promise<{ success: boolean; amount?: number; jobName?: string; cooldownRemainingSec?: number }> {
    const member = await this.getMember(guildId, userId);
    const now = new Date();
    const cooldownMs = 60 * 60 * 1000; // 1 hour

    if (member.lastWork) {
      const msDiff = now.getTime() - new Date(member.lastWork).getTime();
      if (msDiff < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - msDiff) / 1000);
        return { success: false, cooldownRemainingSec: remainingSec };
      }
    }

    const jobs = [
      'Développeur chez Florynx Labs',
      'Modérateur de serveur Discord',
      'Designer UI/UX',
      'Analyste de données',
      'Ingénieur Cyber-Sécurité',
      'Créateur de contenus Tech',
    ];

    const jobName = jobs[Math.floor(Math.random() * jobs.length)];
    const earnedAmount = Math.floor(Math.random() * 150) + 75; // 75 - 225

    await prisma.member.update({
      where: { id: member.id },
      data: {
        balance: { increment: earnedAmount },
        lastWork: now,
      },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type: 'WORK',
        amount: earnedAmount,
        description: `Travail : ${jobName}`,
      },
    });

    return {
      success: true,
      amount: earnedAmount,
      jobName,
    };
  }

  /**
   * Deposit wallet funds into Bank
   */
  static async depositBank(guildId: string, userId: string, amount: number): Promise<boolean> {
    const member = await this.getMember(guildId, userId);
    if (member.balance < amount || amount <= 0) return false;

    await prisma.member.update({
      where: { id: member.id },
      data: {
        balance: { decrement: amount },
        bankBalance: { increment: amount },
      },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type: 'DEPOSIT',
        amount,
        description: 'Dépôt en banque',
      },
    });

    return true;
  }

  /**
   * Withdraw funds from Bank into wallet
   */
  static async withdrawBank(guildId: string, userId: string, amount: number): Promise<boolean> {
    const member = await this.getMember(guildId, userId);
    if (member.bankBalance < amount || amount <= 0) return false;

    await prisma.member.update({
      where: { id: member.id },
      data: {
        bankBalance: { decrement: amount },
        balance: { increment: amount },
      },
    });

    await prisma.transaction.create({
      data: {
        guildId,
        userId,
        type: 'WITHDRAW',
        amount,
        description: 'Retrait de la banque',
      },
    });

    return true;
  }

  /**
   * Transfer funds between members
   */
  static async transfer(guildId: string, fromUserId: string, toUserId: string, amount: number): Promise<boolean> {
    if (amount <= 0 || fromUserId === toUserId) return false;

    const sender = await this.getMember(guildId, fromUserId);
    if (sender.balance < amount) return false;

    const receiver = await this.getMember(guildId, toUserId);

    await prisma.$transaction([
      prisma.member.update({
        where: { id: sender.id },
        data: { balance: { decrement: amount } },
      }),
      prisma.member.update({
        where: { id: receiver.id },
        data: { balance: { increment: amount } },
      }),
      prisma.transaction.create({
        data: {
          guildId,
          userId: fromUserId,
          type: 'PAY',
          amount: -amount,
          description: `Transfert envoyé à <@${toUserId}>`,
        },
      }),
      prisma.transaction.create({
        data: {
          guildId,
          userId: toUserId,
          type: 'PAY',
          amount: amount,
          description: `Transfert reçu de <@${fromUserId}>`,
        },
      }),
    ]);

    return true;
  }

  /**
   * Fetch top rich members leaderboard
   */
  static async getLeaderboard(guildId: string, limit = 10) {
    const members = await prisma.member.findMany({
      where: { guildId },
      orderBy: [
        { balance: 'desc' },
        { bankBalance: 'desc' },
      ],
      take: limit,
    });
    return members;
  }
}
