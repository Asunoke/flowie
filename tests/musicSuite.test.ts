import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    musicSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    playlist: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/database/db.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/utils/logger.js', () => ({ logger: mockLogger }));
// Mock Shoukaku/Kazagumo — no real Lavalink node needed for unit tests
vi.mock('kazagumo', () => ({
  Kazagumo: vi.fn().mockImplementation(() => ({
    shoukaku: {
      on: vi.fn(),
    },
    on: vi.fn(),
    players: new Map(),
    search: vi.fn(),
    createPlayer: vi.fn(),
  })),
  Plugins: {},
}));
vi.mock('shoukaku', () => ({
  Connectors: {
    DiscordJS: vi.fn().mockImplementation(() => ({})),
  },
}));

// Import after mocks
import { formatDuration, buildProgressBar, checkDJPermission } from '../src/services/musicService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Utility Function Tests ───────────────────────────────────────────────

describe('MusicService Utilities', () => {
  describe('formatDuration()', () => {
    it('formats short tracks correctly (mm:ss)', () => {
      expect(formatDuration(90_000)).toBe('1:30');
      expect(formatDuration(3_600_000)).toBe('1:00:00');
      expect(formatDuration(0)).toBe('∞');
    });

    it('pads seconds correctly', () => {
      expect(formatDuration(65_000)).toBe('1:05');
    });
  });

  describe('buildProgressBar()', () => {
    it('returns 0% bar for zero position', () => {
      const bar = buildProgressBar(0, 180_000);
      expect(bar).toContain('0%');
    });

    it('returns 100% for completed track', () => {
      const bar = buildProgressBar(180_000, 180_000);
      expect(bar).toContain('100%');
    });

    it('returns infinite bar when length is 0', () => {
      const bar = buildProgressBar(0, 0);
      expect(bar).toContain('──');
    });
  });
});

// ─── DJ Permission Check Tests ────────────────────────────────────────────

describe('checkDJPermission()', () => {
  it('allows admin regardless of DJ role', async () => {
    mockPrisma.musicSettings.findUnique.mockResolvedValue({ djRoleId: 'role-dj-123' });
    const result = await checkDJPermission('guild-1', 'user-1', [], true);
    expect(result).toBe(true);
  });

  it('allows member when no DJ role is configured', async () => {
    mockPrisma.musicSettings.findUnique.mockResolvedValue({ djRoleId: null });
    const result = await checkDJPermission('guild-1', 'user-1', ['some-role'], false);
    expect(result).toBe(true);
  });

  it('blocks member without DJ role when DJ role is set', async () => {
    mockPrisma.musicSettings.findUnique.mockResolvedValue({ djRoleId: 'role-dj-123' });
    const result = await checkDJPermission('guild-1', 'user-1', ['other-role'], false);
    expect(result).toBe(false);
  });

  it('allows member who has the DJ role', async () => {
    mockPrisma.musicSettings.findUnique.mockResolvedValue({ djRoleId: 'role-dj-123' });
    const result = await checkDJPermission('guild-1', 'user-1', ['role-dj-123', 'other-role'], false);
    expect(result).toBe(true);
  });
});
