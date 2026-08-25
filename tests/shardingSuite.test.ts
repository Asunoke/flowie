import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB, Redis & Logger ───────────────────────────────────────────────

const { mockPrisma, mockLogger, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    guild: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

import { GuildConfigService } from '../src/services/guildConfigService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GuildConfigService Tests ──────────────────────────────────────────────

describe('GuildConfigService', () => {
  it('should return cached config from Redis on hit', async () => {
    const cachedConfig = { id: 'guild-100', language: 'fr', currencyName: 'Flow' };
    mockRedis.get.mockResolvedValue(JSON.stringify(cachedConfig));

    const res = await GuildConfigService.getGuildConfig('guild-100');

    expect(res).toEqual(cachedConfig);
    expect(mockRedis.get).toHaveBeenCalledWith('guild:config:guild-100');
    expect(mockPrisma.guild.findUnique).not.toHaveBeenCalled();
  });

  it('should query DB and write to Redis on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    const dbConfig = { id: 'guild-200', language: 'fr', currencyName: 'Flow', welcomeEnabled: false };
    mockPrisma.guild.findUnique.mockResolvedValue(dbConfig);

    const res = await GuildConfigService.getGuildConfig('guild-200');

    expect(res).toEqual(dbConfig);
    expect(mockPrisma.guild.findUnique).toHaveBeenCalledWith({ where: { id: 'guild-200' } });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'guild:config:guild-200',
      JSON.stringify(dbConfig),
      'EX',
      expect.any(Number)
    );
  });

  it('should invalidate Redis cache on config update', async () => {
    mockPrisma.guild.update.mockResolvedValue({ id: 'guild-300', currencyName: 'Gold' });

    await GuildConfigService.updateGuildConfig('guild-300', { currencyName: 'Gold' });

    expect(mockPrisma.guild.update).toHaveBeenCalledWith({
      where: { id: 'guild-300' },
      data: { currencyName: 'Gold' },
    });
    expect(mockRedis.del).toHaveBeenCalledWith('guild:config:guild-300');
  });
});
