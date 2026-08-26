import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    inviteJoin: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
    },
    inviteBonus: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../src/services/redisService.js', () => ({
  redis: {
    del: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
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

import { InviteService } from '../src/services/inviteService.js';
import { prisma } from '../src/database/db.js';
import { redis } from '../src/services/redisService.js';

// Helpers for creating mock Guild / GuildMember objects
function makeMockGuild(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guild-123',
    name: 'Test Guild',
    invites: {
      fetch: vi.fn().mockResolvedValue(new Map()),
    },
    fetchVanityData: vi.fn().mockResolvedValue(null),
    fetchAuditLogs: vi.fn().mockResolvedValue({ entries: new Map() }),
    members: {
      me: {
        permissions: { has: vi.fn().mockReturnValue(true) },
      },
    },
    ...overrides,
  };
}

function makeMockMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-456',
    user: { tag: 'TestUser#0001', id: 'member-456' },
    guild: makeMockGuild(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InviteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─ cacheGuildInvites ─────────────────────────────────────────────────────

  describe('cacheGuildInvites', () => {
    it('should return false and not throw when bot lacks ManageGuild permission', async () => {
      const guild = makeMockGuild({
        members: { me: { permissions: { has: vi.fn().mockReturnValue(false) } } },
      });

      const result = await InviteService.cacheGuildInvites(guild as never);
      expect(result).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('should cache invites as Redis JSON blob when bot has ManageGuild', async () => {
      const mockInvites = new Map([
        ['abc123', { code: 'abc123', uses: 5, inviter: { id: 'inviter-789' } }],
        ['xyz999', { code: 'xyz999', uses: 2, inviter: { id: 'inviter-001' } }],
      ]);

      const guild = makeMockGuild({
        invites: { fetch: vi.fn().mockResolvedValue(mockInvites) },
        fetchVanityData: vi.fn().mockResolvedValue({ code: 'myvanity', uses: 10 }),
      });

      vi.mocked(redis.set).mockResolvedValue('OK' as never);

      const result = await InviteService.cacheGuildInvites(guild as never);
      expect(result).toBe(true);

      // Should store JSON blob under invite:cache key
      expect(redis.set).toHaveBeenCalledWith(
        'invite:cache:guild-123',
        expect.stringContaining('abc123')
      );
      // Should store vanity URL uses separately
      expect(redis.set).toHaveBeenCalledWith('invite:vanity:guild-123', '10');
    });
  });

  // ─ trackMemberJoin ───────────────────────────────────────────────────────

  describe('trackMemberJoin', () => {
    it('should detect invite by usage count increase and save DB record', async () => {
      const cachedHash = {
        inviteCode1: { uses: 5, inviterId: 'inviter-789' },
      };
      const currentInvites = new Map([
        ['inviteCode1', { code: 'inviteCode1', uses: 6, inviter: { id: 'inviter-789' } }],
      ]);

      vi.mocked(redis.get).mockImplementation(async (key: string) => {
        if (key.startsWith('invite:cache:')) return JSON.stringify(cachedHash);
        return null;
      });
      vi.mocked(redis.set).mockResolvedValue('OK' as never);
      vi.mocked(prisma.inviteJoin.create).mockResolvedValue({} as never);

      const member = makeMockMember();
      const guild = makeMockGuild({
        id: 'guild-123',
        invites: { fetch: vi.fn().mockResolvedValue(currentInvites) },
        fetchVanityData: vi.fn().mockResolvedValue(null),
      });

      await InviteService.trackMemberJoin(guild as never, member as never);

      expect(prisma.inviteJoin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guildId: 'guild-123',
            memberId: 'member-456',
            inviterId: 'inviter-789',
            inviteCode: 'inviteCode1',
            joinType: 'normal',
          }),
        })
      );
    });

    it('should detect vanity URL usage increase and save DB record', async () => {
      vi.mocked(redis.get).mockImplementation(async (key: string) => {
        if (key.startsWith('invite:vanity:')) return '10';
        return null;
      });
      vi.mocked(redis.set).mockResolvedValue('OK' as never);
      vi.mocked(prisma.inviteJoin.create).mockResolvedValue({} as never);

      const member = makeMockMember();
      const guild = makeMockGuild({
        id: 'guild-123',
        invites: { fetch: vi.fn().mockResolvedValue(new Map()) },
        fetchVanityData: vi.fn().mockResolvedValue({ code: 'myvanity', uses: 11 }),
      });

      await InviteService.trackMemberJoin(guild as never, member as never);

      expect(prisma.inviteJoin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            joinType: 'vanity',
            inviteCode: 'myvanity',
          }),
        })
      );
    });

    it('should mark joinType as unknown when no invite detected', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.set).mockResolvedValue('OK' as never);
      vi.mocked(prisma.inviteJoin.create).mockResolvedValue({} as never);

      // AuditLog entries use discord.js Collection which has .find(), not a native Map
      const mockAuditEntries = { find: vi.fn().mockReturnValue(undefined) };
      const guild = makeMockGuild({
        invites: { fetch: vi.fn().mockResolvedValue(new Map()) },
        fetchVanityData: vi.fn().mockResolvedValue(null),
        fetchAuditLogs: vi.fn().mockResolvedValue({ entries: mockAuditEntries }),
      });

      const member = makeMockMember({ guild });
      await InviteService.trackMemberJoin(guild as never, member as never);

      expect(prisma.inviteJoin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ joinType: 'unknown' }),
        })
      );
    });

  });

  // ─ trackMemberLeave ──────────────────────────────────────────────────────

  describe('trackMemberLeave', () => {
    it('should mark leftEarly = true for a member who left within 10 minutes', async () => {
      const joinRecord = {
        id: 'join-1',
        joinedAt: new Date(Date.now() - 4 * 60 * 1000), // 4 minutes ago
      };
      vi.mocked(prisma.inviteJoin.findFirst).mockResolvedValue(joinRecord as never);
      vi.mocked(prisma.inviteJoin.update).mockResolvedValue({} as never);

      await InviteService.trackMemberLeave('guild-123', 'member-456');

      expect(prisma.inviteJoin.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { leftEarly: true } })
      );
    });

    it('should NOT mark leftEarly when member stayed more than 10 minutes', async () => {
      const joinRecord = {
        id: 'join-2',
        joinedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      };
      vi.mocked(prisma.inviteJoin.findFirst).mockResolvedValue(joinRecord as never);

      await InviteService.trackMemberLeave('guild-123', 'member-456');

      expect(prisma.inviteJoin.update).not.toHaveBeenCalled();
    });

    it('should do nothing when no join record found', async () => {
      vi.mocked(prisma.inviteJoin.findFirst).mockResolvedValue(null);
      await InviteService.trackMemberLeave('guild-123', 'unknown-member');
      expect(prisma.inviteJoin.update).not.toHaveBeenCalled();
    });
  });

  // ─ getMemberInvites ──────────────────────────────────────────────────────

  describe('getMemberInvites', () => {
    it('should correctly compute stats including bonus', async () => {
      vi.mocked(prisma.inviteJoin.count)
        .mockResolvedValueOnce(7 as never)  // realInvites
        .mockResolvedValueOnce(2 as never)  // fakeInvites
        .mockResolvedValueOnce(9 as never); // totalJoins

      vi.mocked(prisma.inviteBonus.findUnique).mockResolvedValue({
        amount: 3,
      } as never);

      const stats = await InviteService.getMemberInvites('guild-123', 'user-1');

      expect(stats.realInvites).toBe(7);
      expect(stats.fakeInvites).toBe(2);
      expect(stats.totalJoins).toBe(9);
      expect(stats.bonus).toBe(3);
      expect(stats.totalValid).toBe(10); // 7 + 3
    });

    it('should return bonus=0 and correct totalValid when no bonus record exists', async () => {
      vi.mocked(prisma.inviteJoin.count)
        .mockResolvedValueOnce(5 as never)
        .mockResolvedValueOnce(1 as never)
        .mockResolvedValueOnce(6 as never);

      vi.mocked(prisma.inviteBonus.findUnique).mockResolvedValue(null);

      const stats = await InviteService.getMemberInvites('guild-123', 'user-2');

      expect(stats.bonus).toBe(0);
      expect(stats.totalValid).toBe(5);
    });
  });

  // ─ addBonus ──────────────────────────────────────────────────────────────

  describe('addBonus', () => {
    it('should upsert bonus record in DB', async () => {
      vi.mocked(prisma.inviteBonus.upsert).mockResolvedValue({} as never);

      await InviteService.addBonus('guild-123', 'user-1', 5, 'Concours gagnant');

      expect(prisma.inviteBonus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { guildId_userId: { guildId: 'guild-123', userId: 'user-1' } },
          create: { guildId: 'guild-123', userId: 'user-1', amount: 5, reason: 'Concours gagnant' },
          update: { amount: { increment: 5 }, reason: 'Concours gagnant' },
        })
      );
    });
  });

  // ─ getWhoInvited ─────────────────────────────────────────────────────────

  describe('getWhoInvited', () => {
    it('should query the most recent join record for a member', async () => {
      const mockRecord = { id: 'join-1', inviterId: 'inviter-789', joinType: 'normal', inviteCode: 'abc123' };
      vi.mocked(prisma.inviteJoin.findFirst).mockResolvedValue(mockRecord as never);

      const result = await InviteService.getWhoInvited('guild-123', 'member-456');

      expect(result).toEqual(mockRecord);
      expect(prisma.inviteJoin.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { guildId: 'guild-123', memberId: 'member-456' },
          orderBy: { joinedAt: 'desc' },
        })
      );
    });

    it('should return null when no invite record found', async () => {
      vi.mocked(prisma.inviteJoin.findFirst).mockResolvedValue(null);
      const result = await InviteService.getWhoInvited('guild-123', 'ghost-member');
      expect(result).toBeNull();
    });
  });

  // ─ resetInvites ──────────────────────────────────────────────────────────

  describe('resetInvites', () => {
    it('should delete joins and bonuses for a specific user only', async () => {
      vi.mocked(prisma.inviteJoin.deleteMany).mockResolvedValue({} as never);
      vi.mocked(prisma.inviteBonus.deleteMany).mockResolvedValue({} as never);

      await InviteService.resetInvites('guild-123', 'user-1');

      expect(prisma.inviteJoin.deleteMany).toHaveBeenCalledWith({
        where: { guildId: 'guild-123', inviterId: 'user-1' },
      });
      expect(prisma.inviteBonus.deleteMany).toHaveBeenCalledWith({
        where: { guildId: 'guild-123', userId: 'user-1' },
      });
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should delete ALL joins, bonuses and clear Redis cache for guild reset', async () => {
      vi.mocked(prisma.inviteJoin.deleteMany).mockResolvedValue({} as never);
      vi.mocked(prisma.inviteBonus.deleteMany).mockResolvedValue({} as never);
      vi.mocked(redis.del).mockResolvedValue(1 as never);

      await InviteService.resetInvites('guild-123');

      expect(prisma.inviteJoin.deleteMany).toHaveBeenCalledWith({ where: { guildId: 'guild-123' } });
      expect(prisma.inviteBonus.deleteMany).toHaveBeenCalledWith({ where: { guildId: 'guild-123' } });
      expect(redis.del).toHaveBeenCalledWith('invite:cache:guild-123');
      expect(redis.del).toHaveBeenCalledWith('invite:vanity:guild-123');
    });
  });
});
