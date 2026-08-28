import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    timeCapsule: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    guild: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/services/guildConfigService.js', () => ({
  GuildConfigService: {
    getGuildConfig: vi.fn().mockResolvedValue({
      id: 'g1',
      timeCapsuleChannelId: 'c1',
      logChannelId: 'c2',
    }),
  },
}));

import { TimeCapsuleService } from '../src/services/timeCapsuleService.js';
import { prisma } from '../src/database/db.js';
import { logger } from '../src/utils/logger.js';

describe('TimeCapsuleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseTrigger', () => {
    it('should parse member count triggers correctly', () => {
      const res1 = TimeCapsuleService.parseTrigger('1000 membres', 500);
      expect(res1.type).toBe('member_count');
      expect(res1.memberCount).toBe(1000);

      const res2 = TimeCapsuleService.parseTrigger('5000 members', 100);
      expect(res2.type).toBe('member_count');
      expect(res2.memberCount).toBe(5000);
    });

    it('should throw error if member count threshold is <= current member count', () => {
      expect(() => TimeCapsuleService.parseTrigger('500 membres', 500)).toThrow(
        /doit être supérieur au nombre actuel/
      );
      expect(() => TimeCapsuleService.parseTrigger('100 membres', 500)).toThrow(
        /doit être supérieur au nombre actuel/
      );
    });

    it('should parse relative duration triggers >= 24h', () => {
      const res24h = TimeCapsuleService.parseTrigger('24h', 10);
      expect(res24h.type).toBe('date');
      expect(res24h.date).toBeInstanceOf(Date);
      expect(res24h.date!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

      const res6m = TimeCapsuleService.parseTrigger('6 mois', 10);
      expect(res6m.type).toBe('date');
      expect(res6m.date!.getTime()).toBeGreaterThan(Date.now() + 150 * 86400 * 1000);

      const res1y = TimeCapsuleService.parseTrigger('1 an', 10);
      expect(res1y.type).toBe('date');
    });

    it('should throw error if date trigger is less than 24h in the future', () => {
      expect(() => TimeCapsuleService.parseTrigger('2h', 10)).toThrow(
        /ne peut pas être fixée à moins de 24h/
      );
      expect(() => TimeCapsuleService.parseTrigger('12 heures', 10)).toThrow(
        /ne peut pas être fixée à moins de 24h/
      );
    });

    it('should parse ISO date strings >= 24h in future', () => {
      const futureDateStr = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
      const res = TimeCapsuleService.parseTrigger(futureDateStr, 10);
      expect(res.type).toBe('date');
      expect(res.date).toBeInstanceOf(Date);
    });

    it('should throw error for invalid trigger string format', () => {
      expect(() => TimeCapsuleService.parseTrigger('invalid_trigger', 10)).toThrow(
        /Format de déclencheur invalide/
      );
    });
  });

  describe('createCapsule', () => {
    it('should throw error for empty content', async () => {
      await expect(
        TimeCapsuleService.createCapsule({
          guildId: 'g1',
          authorId: 'u1',
          authorTag: 'User#0001',
          content: '   ',
          triggerInput: '6 mois',
          currentMemberCount: 10,
        })
      ).rejects.toThrow(/vide/);
    });

    it('should throw error if content exceeds 2000 characters', async () => {
      const longMessage = 'a'.repeat(2001);
      await expect(
        TimeCapsuleService.createCapsule({
          guildId: 'g1',
          authorId: 'u1',
          authorTag: 'User#0001',
          content: longMessage,
          triggerInput: '6 mois',
          currentMemberCount: 10,
        })
      ).rejects.toThrow(/dépasser 2000 caractères/);
    });

    it('should throw error if user reaches max active capsules limit (3)', async () => {
      vi.mocked(prisma.timeCapsule.count).mockResolvedValue(3 as never);

      await expect(
        TimeCapsuleService.createCapsule({
          guildId: 'g1',
          authorId: 'u1',
          authorTag: 'User#0001',
          content: 'Message secret',
          triggerInput: '6 mois',
          currentMemberCount: 10,
        })
      ).rejects.toThrow(/limite de 3 capsules actives/);
    });

    it('should create capsule successfully when constraints are satisfied', async () => {
      vi.mocked(prisma.timeCapsule.count).mockResolvedValue(1 as never);
      const mockCreated = {
        id: 'cap_123',
        guildId: 'g1',
        authorId: 'u1',
        authorTag: 'User#0001',
        content: 'Secret',
        isPublic: true,
        triggerType: 'member_count',
        triggerMemberCount: 1000,
        opened: false,
        createdAt: new Date(),
      };
      vi.mocked(prisma.timeCapsule.create).mockResolvedValue(mockCreated as never);

      const result = await TimeCapsuleService.createCapsule({
        guildId: 'g1',
        authorId: 'u1',
        authorTag: 'User#0001',
        content: 'Secret',
        triggerInput: '1000 membres',
        isPublic: true,
        currentMemberCount: 100,
      });

      expect(result.id).toBe('cap_123');
      expect(prisma.timeCapsule.create).toHaveBeenCalled();
    });
  });

  describe('listPublicCapsules & listUserCapsules', () => {
    it('should list unopened public capsules for a guild', async () => {
      const mockCapsules = [
        { id: 'c1', isPublic: true, opened: false },
        { id: 'c2', isPublic: true, opened: false },
      ];
      vi.mocked(prisma.timeCapsule.findMany).mockResolvedValue(mockCapsules as never);

      const res = await TimeCapsuleService.listPublicCapsules('g1');
      expect(res).toHaveLength(2);
      expect(prisma.timeCapsule.findMany).toHaveBeenCalledWith({
        where: { guildId: 'g1', opened: false, isPublic: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should list all user capsules (public and secret)', async () => {
      const mockCapsules = [
        { id: 'c1', isPublic: true, opened: false },
        { id: 'c2', isPublic: false, opened: true },
      ];
      vi.mocked(prisma.timeCapsule.findMany).mockResolvedValue(mockCapsules as never);

      const res = await TimeCapsuleService.listUserCapsules('g1', 'u1');
      expect(res).toHaveLength(2);
      expect(prisma.timeCapsule.findMany).toHaveBeenCalledWith({
        where: { guildId: 'g1', authorId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('forceOpenCapsule', () => {
    it('should throw error if capsule does not exist', async () => {
      vi.mocked(prisma.timeCapsule.findUnique).mockResolvedValue(null as never);

      await expect(TimeCapsuleService.forceOpenCapsule('invalid_id', 'owner_1')).rejects.toThrow(
        /introuvable/
      );
    });

    it('should update capsule status and issue warn audit log', async () => {
      const mockCap = { id: 'cap_1', guildId: 'g1', authorId: 'u1', content: 'Secret' };
      vi.mocked(prisma.timeCapsule.findUnique).mockResolvedValue(mockCap as never);
      vi.mocked(prisma.timeCapsule.update).mockResolvedValue({ ...mockCap, opened: true } as never);

      const result = await TimeCapsuleService.forceOpenCapsule('cap_1', 'owner_1');

      expect(result.opened).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('[OWNER_FORCE_OPEN]')
      );
    });
  });
});
