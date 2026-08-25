import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB & Logger ──────────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    guild: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      findMany: vi.fn(),
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

import { GameEngine } from '../src/services/gameEngine.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Roulette Tests ────────────────────────────────────────────────────────

describe('GameEngine.playRoulette', () => {
  it('should return valid outcome between 0 and 36', () => {
    const res = GameEngine.playRoulette('rouge');
    expect(res.spunNumber).toBeGreaterThanOrEqual(0);
    expect(res.spunNumber).toBeLessThanOrEqual(36);
    expect(['🔴 Rouge', '⚫ Noir', '🟢 Vert']).toContain(res.color);
    expect(typeof res.win).toBe('boolean');
  });

  it('should return 36x multiplier on exact number win', () => {
    // Test multiple times until exact hit or verify logic
    let hit = false;
    for (let i = 0; i < 200; i++) {
      const res = GameEngine.playRoulette('7');
      if (res.spunNumber === 7) {
        expect(res.win).toBe(true);
        expect(res.multiplier).toBe(36);
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
  });
});

// ─── Hangman ASCII Figure Tests ───────────────────────────────────────────

describe('GameEngine.getHangmanASCII', () => {
  it('should return correct ASCII stage string', () => {
    const stage0 = GameEngine.getHangmanASCII(0);
    expect(stage0).toContain('+---+');

    const stage6 = GameEngine.getHangmanASCII(6);
    expect(stage6).toContain('/ \\');
  });
});
