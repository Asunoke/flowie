import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB, Redis & Logger ───────────────────────────────────────────────

const { mockPrisma, mockLogger, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    memberXP: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    levelRole: {
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

import { LevelingService } from '../src/services/levelingService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Leveling Math Tests ───────────────────────────────────────────────────

describe('LevelingService Math & Calculations', () => {
  it('should calculate level correctly from XP', () => {
    expect(LevelingService.calcLevel(0)).toBe(0);
    expect(LevelingService.calcLevel(90)).toBe(3);
    expect(LevelingService.calcLevel(1000)).toBe(10);
  });

  it('should calculate XP required for a given level', () => {
    expect(LevelingService.xpForLevel(0)).toBe(0);
    expect(LevelingService.xpForLevel(5)).toBe(250);
    expect(LevelingService.xpForLevel(10)).toBe(1000);
  });
});
