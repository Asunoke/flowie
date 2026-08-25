import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB & Logger ──────────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    premiumWhitelist: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    guild: {
      count: vi.fn(),
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
}));

vi.mock('../src/database/db.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { PlanService } from '../src/services/planService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Plan & Quota Unit Tests ───────────────────────────────────────────────

describe('PlanService — Quota & Whitelist', () => {
  it('should block a Free user with 1 active server from adding a 2nd server', async () => {
    // Free user has no entry in premiumWhitelist
    mockPrisma.premiumWhitelist.findUnique.mockResolvedValue(null);
    // User already has 1 active server
    mockPrisma.guild.count.mockResolvedValue(1);

    const quota = await PlanService.getQuotaInfo('free-user-123');

    expect(quota.isPremium).toBe(false);
    expect(quota.maxGuilds).toBe(1);
    expect(quota.activeCount).toBe(1);
    expect(quota.allowed).toBe(false);

    // Validate checkQuotaForNewGuild
    mockPrisma.guild.upsert.mockResolvedValue({ id: 'guild-2', isLocked: true });

    const res = await PlanService.checkQuotaForNewGuild('guild-2', 'free-user-123');
    expect(res.allowed).toBe(false);
    expect(mockPrisma.guild.upsert).toHaveBeenCalledWith({
      where: { id: 'guild-2' },
      create: { id: 'guild-2', ownerUserId: 'free-user-123', isLocked: true },
      update: { ownerUserId: 'free-user-123', isLocked: true },
    });
  });

  it('should allow a Premium user with maxGuilds=5 and 4 active servers to add a 5th server', async () => {
    // Whitelisted user with maxGuilds = 5
    mockPrisma.premiumWhitelist.findUnique.mockResolvedValue({
      userId: 'premium-user-456',
      maxGuilds: 5,
      expiresAt: null,
    });
    // User currently has 4 active servers
    mockPrisma.guild.count.mockResolvedValue(4);

    const quota = await PlanService.getQuotaInfo('premium-user-456');

    expect(quota.isPremium).toBe(true);
    expect(quota.maxGuilds).toBe(5);
    expect(quota.activeCount).toBe(4);
    expect(quota.allowed).toBe(true);

    // Validate checkQuotaForNewGuild
    mockPrisma.guild.upsert.mockResolvedValue({ id: 'guild-5', isLocked: false });

    const res = await PlanService.checkQuotaForNewGuild('guild-5', 'premium-user-456');
    expect(res.allowed).toBe(true);
    expect(mockPrisma.guild.upsert).toHaveBeenCalledWith({
      where: { id: 'guild-5' },
      create: { id: 'guild-5', ownerUserId: 'premium-user-456', isLocked: false },
      update: { ownerUserId: 'premium-user-456', isLocked: false },
    });
  });
});
