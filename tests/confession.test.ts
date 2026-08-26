import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    confession: {
      create: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    confessionConfig: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    guild: {
      findUnique: vi.fn(),
    },
  },
}));

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../src/services/redisService.js', () => ({
  redis: {
    ttl: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
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

import { ConfessionService } from '../src/services/confessionService.js';
import { prisma } from '../src/database/db.js';
import { redis } from '../src/services/redisService.js';

function makeMockGuild() {
  const channel = {
    id: 'chan-123',
    isTextBased: () => true,
    send: vi.fn().mockResolvedValue({ id: 'msg-456' }),
  };

  return {
    id: 'guild-777',
    name: 'Test Server',
    channels: {
      cache: new Map([['chan-123', channel]]),
    },
  };
}

describe('ConfessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAutoModBlocked', () => {
    it('should block external links and discord invite links', () => {
      expect(ConfessionService.isAutoModBlocked('Rejoignez https://discord.gg/invitelink !')).toBe(true);
      expect(ConfessionService.isAutoModBlocked('Visitez http://phishing-site.com')).toBe(true);
    });

    it('should allow normal text without links', () => {
      expect(ConfessionService.isAutoModBlocked('J\'avoue que j\'aime le chocolat chaud le matin.')).toBe(false);
    });
  });

  describe('submitConfession', () => {
    it('should throw when confession system is not configured', async () => {
      vi.mocked(prisma.confessionConfig.findUnique).mockResolvedValue(null);
      const guild = makeMockGuild();

      await expect(
        ConfessionService.submitConfession(guild as never, 'user-1', 'Ma confession')
      ).rejects.toThrow(/n'est pas configuré/);
    });

    it('should throw when message contains AutoMod blocked content', async () => {
      vi.mocked(prisma.confessionConfig.findUnique).mockResolvedValue({
        id: 'cfg-1',
        guildId: 'guild-777',
        channelId: 'chan-123',
        enabled: true,
      } as never);

      const guild = makeMockGuild();

      await expect(
        ConfessionService.submitConfession(guild as never, 'user-1', 'Suivez moi sur https://spam.com')
      ).rejects.toThrow(/AutoMod/);
    });

    it('should throw when user is under cooldown', async () => {
      vi.mocked(prisma.confessionConfig.findUnique).mockResolvedValue({
        id: 'cfg-1',
        guildId: 'guild-777',
        channelId: 'chan-123',
        enabled: true,
      } as never);
      vi.mocked(redis.ttl).mockResolvedValue(300 as never); // 5 minutes remaining

      const guild = makeMockGuild();

      await expect(
        ConfessionService.submitConfession(guild as never, 'user-1', 'Message valide')
      ).rejects.toThrow(/Veuillez patienter/);
    });

    it('should post confession, increment number #N, and set Redis 10 min cooldown', async () => {
      vi.mocked(prisma.confessionConfig.findUnique).mockResolvedValue({
        id: 'cfg-1',
        guildId: 'guild-777',
        channelId: 'chan-123',
        enabled: true,
      } as never);
      vi.mocked(redis.ttl).mockResolvedValue(-2 as never); // No cooldown active
      vi.mocked(prisma.confession.count).mockResolvedValue(41 as never); // 41 existing -> next is #42
      vi.mocked(prisma.confession.create).mockResolvedValue({} as never);
      vi.mocked(redis.set).mockResolvedValue('OK' as never);

      const guild = makeMockGuild();
      const res = await ConfessionService.submitConfession(guild as never, 'user-999', 'Mon grand secret');

      expect(res.number).toBe(42);
      expect(res.messageId).toBe('msg-456');
      expect(prisma.confession.create).toHaveBeenCalledWith({
        data: {
          guildId: 'guild-777',
          number: 42,
          authorId: 'user-999',
          content: 'Mon grand secret',
          messageId: 'msg-456',
        },
      });
      expect(redis.set).toHaveBeenCalledWith('confession:cooldown:guild-777:user-999', '1', 'EX', 600);
    });
  });

  describe('revealAuthor', () => {
    it('should find confession by number and return author details for staff modlog', async () => {
      const mockConfession = {
        id: 'c-1',
        guildId: 'guild-777',
        number: 42,
        authorId: 'secret-author-88',
        content: 'Mon grand secret',
        messageId: 'msg-456',
        createdAt: new Date(),
      };

      vi.mocked(prisma.confession.findUnique).mockResolvedValue(mockConfession as never);
      vi.mocked(prisma.guild.findUnique).mockResolvedValue({ logChannelId: null } as never);

      const guild = makeMockGuild();
      const res = await ConfessionService.revealAuthor(guild as never, 'staff-user', '42');

      expect(res.authorId).toBe('secret-author-88');
      expect(res.number).toBe(42);
    });
  });
});
