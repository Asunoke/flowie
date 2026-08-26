import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    birthday: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    birthdayConfig: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// ─── Mock Logger ──────────────────────────────────────────────────────────────
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { BirthdayService } from '../src/services/birthdayService.js';
import { prisma } from '../src/database/db.js';

describe('BirthdayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidDate', () => {
    it('should validate standard dates correctly', () => {
      expect(BirthdayService.isValidDate(15, 6)).toBe(true);
      expect(BirthdayService.isValidDate(31, 12)).toBe(true);
      expect(BirthdayService.isValidDate(1, 1)).toBe(true);
      expect(BirthdayService.isValidDate(29, 2, 2024)).toBe(true); // Leap year
    });

    it('should reject invalid dates', () => {
      expect(BirthdayService.isValidDate(31, 4)).toBe(false); // April has 30 days
      expect(BirthdayService.isValidDate(32, 1)).toBe(false);
      expect(BirthdayService.isValidDate(15, 13)).toBe(false);
      expect(BirthdayService.isValidDate(29, 2, 2023)).toBe(false); // Non-leap year
    });
  });

  describe('setBirthday', () => {
    it('should throw an error for invalid dates', async () => {
      await expect(BirthdayService.setBirthday('g1', 'u1', 31, 4)).rejects.toThrow(/n'est pas une date valide/);
    });

    it('should upsert birthday record in DB for valid dates', async () => {
      vi.mocked(prisma.birthday.upsert).mockResolvedValue({
        id: 'b1',
        guildId: 'g1',
        userId: 'u1',
        day: 10,
        month: 5,
        year: 1995,
        createdAt: new Date(),
      } as never);

      const res = await BirthdayService.setBirthday('g1', 'u1', 10, 5, 1995);

      expect(prisma.birthday.upsert).toHaveBeenCalledWith({
        where: { guildId_userId: { guildId: 'g1', userId: 'u1' } },
        create: { guildId: 'g1', userId: 'u1', day: 10, month: 5, year: 1995 },
        update: { day: 10, month: 5, year: 1995 },
      });
      expect(res.id).toBe('b1');
    });
  });

  describe('removeBirthday', () => {
    it('should delete birthday record and return boolean status', async () => {
      vi.mocked(prisma.birthday.deleteMany).mockResolvedValue({ count: 1 } as never);

      const result = await BirthdayService.removeBirthday('g1', 'u1');

      expect(result).toBe(true);
      expect(prisma.birthday.deleteMany).toHaveBeenCalledWith({
        where: { guildId: 'g1', userId: 'u1' },
      });
    });
  });

  describe('getNextBirthdays', () => {
    it('should compute days until birthday and sort by closest date', async () => {
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      // Mock birthdays: one today, one tomorrow
      const mockBirthdays = [
        { id: '1', guildId: 'g1', userId: 'u-tomorrow', day: currentDay + 1, month: currentMonth, year: 2000, createdAt: new Date() },
        { id: '2', guildId: 'g1', userId: 'u-today', day: currentDay, month: currentMonth, year: 1990, createdAt: new Date() },
      ];

      vi.mocked(prisma.birthday.findMany).mockResolvedValue(mockBirthdays as never);

      const { entries } = await BirthdayService.getNextBirthdays('g1');

      expect(entries).toHaveLength(2);
      expect(entries[0].userId).toBe('u-today');
      expect(entries[0].daysUntil).toBe(0);
      expect(entries[1].userId).toBe('u-tomorrow');
    });
  });

  describe('setConfig', () => {
    it('should upsert birthdayConfig record in DB', async () => {
      vi.mocked(prisma.birthdayConfig.upsert).mockResolvedValue({} as never);

      await BirthdayService.setConfig('g1', 'c1', 'r1', true);

      expect(prisma.birthdayConfig.upsert).toHaveBeenCalledWith({
        where: { guildId: 'g1' },
        create: { guildId: 'g1', channelId: 'c1', roleId: 'r1', enabled: true },
        update: { channelId: 'c1', roleId: 'r1', enabled: true },
      });
    });
  });
});
