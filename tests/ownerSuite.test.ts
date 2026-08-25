import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB & Logger & Redis ──────────────────────────────────────────────

const { mockPrisma, mockLogger, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    blacklist: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockRedis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../src/database/db.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../src/services/redisService.js', () => ({
  redis: mockRedis,
}));

import { BlacklistService } from '../src/services/blacklistService.js';
import { handleOwnerCommand } from '../src/owner-commands/ownerHandler.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Blacklist Service Tests ───────────────────────────────────────────────

describe('BlacklistService', () => {
  it('should detect blacklisted user via Redis cache', async () => {
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'blacklist:user:bad-user-1') return 'Spam intensif';
      return null;
    });

    const res = await BlacklistService.isBlacklisted('bad-user-1', 'guild-1');
    expect(res.blacklisted).toBe(true);
    expect(res.reason).toBe('Spam intensif');
    expect(res.type).toBe('user');
  });

  it('should detect blacklisted guild via Redis cache', async () => {
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'blacklist:guild:bad-guild-1') return 'Raid server';
      return null;
    });

    const res = await BlacklistService.isBlacklisted('normal-user', 'bad-guild-1');
    expect(res.blacklisted).toBe(true);
    expect(res.reason).toBe('Raid server');
    expect(res.type).toBe('guild');
  });
});

// ─── Owner Command Handler Silent Security Tests ──────────────────────────

describe('handleOwnerCommand — Security & Guards', () => {
  it('should silently ignore non-owner messages with no response or error', async () => {
    const mockMessage = {
      author: { id: 'regular-user-99', tag: 'User#0001' },
      content: '!!stats-global',
      reply: vi.fn(),
    } as any;

    const handled = await handleOwnerCommand(mockMessage);

    expect(handled).toBe(false);
    expect(mockMessage.reply).not.toHaveBeenCalled();
  });
});
