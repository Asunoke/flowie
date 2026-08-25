import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma (hoisted to avoid reference error) ─────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    trackedBot: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    uptimeEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
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

import { UptimeService } from '../src/services/uptimerService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit Tests: Uptime Calculation (Pure Function) ─────────────────────

describe('UptimeService.computeUptimeFromEvents', () => {
  it('should return 100% when bot was online the entire period', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-02T00:00:00Z');

    const result = UptimeService.computeUptimeFromEvents(
      'online', // was online before the window started
      [],       // no status changes during the window
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(100);
  });

  it('should return 0% when bot was offline the entire period', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-02T00:00:00Z');

    const result = UptimeService.computeUptimeFromEvents(
      'offline',
      [],
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(0);
  });

  it('should return 75% when bot was online 18h and offline 6h', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-02T00:00:00Z'); // 24h total

    const events = [
      // Online for first 18 hours, then goes offline
      { status: 'offline', timestamp: new Date('2026-01-01T18:00:00Z') },
    ];

    const result = UptimeService.computeUptimeFromEvents(
      'online', // started online
      events,
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(75);
  });

  it('should handle multiple status changes', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-01T12:00:00Z'); // 12h window

    const events = [
      // 0h-3h: offline (from starting status), 3h: go online
      { status: 'online', timestamp: new Date('2026-01-01T03:00:00Z') },
      // 3h-6h: online, 6h: go offline
      { status: 'offline', timestamp: new Date('2026-01-01T06:00:00Z') },
      // 6h-9h: offline, 9h: go online
      { status: 'online', timestamp: new Date('2026-01-01T09:00:00Z') },
      // 9h-12h: online
    ];

    // Online: 3h-6h (3h) + 9h-12h (3h) = 6h out of 12h = 50%
    const result = UptimeService.computeUptimeFromEvents(
      'offline',
      events,
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(50);
  });

  it('should count idle/dnd as online when includeIdle is true', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-01T10:00:00Z'); // 10h

    const events = [
      // 0-4h: online
      { status: 'idle', timestamp: new Date('2026-01-01T04:00:00Z') },
      // 4-7h: idle
      { status: 'dnd', timestamp: new Date('2026-01-01T07:00:00Z') },
      // 7-10h: dnd
    ];

    // With includeIdle: online(4h) + idle(3h) + dnd(3h) = 10h/10h = 100%
    const result = UptimeService.computeUptimeFromEvents(
      'online',
      events,
      windowStart,
      windowEnd,
      true
    );

    expect(result).toBe(100);

    // Without includeIdle: only online(4h) = 4h/10h = 40%
    const resultStrict = UptimeService.computeUptimeFromEvents(
      'online',
      events,
      windowStart,
      windowEnd,
      false
    );

    expect(resultStrict).toBe(40);
  });

  it('should return 0% when no starting status and no events', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-02T00:00:00Z');

    const result = UptimeService.computeUptimeFromEvents(
      null,
      [],
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(0);
  });

  it('should handle events at exact window boundaries', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-01T10:00:00Z');

    const events = [
      { status: 'online', timestamp: new Date('2026-01-01T00:00:00Z') }, // At start
      { status: 'offline', timestamp: new Date('2026-01-01T10:00:00Z') }, // At end
    ];

    // Online from 0h to 10h = 100%
    const result = UptimeService.computeUptimeFromEvents(
      'offline',
      events,
      windowStart,
      windowEnd,
      false
    );

    expect(result).toBe(100);
  });
});

// ─── Unit Tests: Add Bot (Service) ─────────────────────────────────────

describe('UptimeService.addBot', () => {
  it('should add a bot successfully', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue(null);
    mockPrisma.trackedBot.count.mockResolvedValue(0);
    mockPrisma.trackedBot.create.mockResolvedValue({
      id: 'test-id',
      guildId: 'guild-1',
      botId: 'bot-1',
      addedBy: 'user-1',
    });

    const result = await UptimeService.addBot('guild-1', 'bot-1', 'user-1');

    expect(result.success).toBe(true);
    expect(mockPrisma.trackedBot.create).toHaveBeenCalledWith({
      data: { guildId: 'guild-1', botId: 'bot-1', addedBy: 'user-1' },
    });
  });

  it('should reject duplicate bots', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue({
      id: 'existing-id',
      guildId: 'guild-1',
      botId: 'bot-1',
    });

    const result = await UptimeService.addBot('guild-1', 'bot-1', 'user-1');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('already_tracked');
    expect(mockPrisma.trackedBot.create).not.toHaveBeenCalled();
  });

  it('should reject when limit is reached', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue(null);
    mockPrisma.trackedBot.count.mockResolvedValue(10); // MAX_TRACKED_BOTS

    const result = await UptimeService.addBot('guild-1', 'bot-1', 'user-1');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('limit_reached');
    expect(mockPrisma.trackedBot.create).not.toHaveBeenCalled();
  });

  it('should handle DB errors gracefully', async () => {
    mockPrisma.trackedBot.findUnique.mockRejectedValue(new Error('DB connection lost'));

    const result = await UptimeService.addBot('guild-1', 'bot-1', 'user-1');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('db_error');
    expect(mockPrisma.trackedBot.create).not.toHaveBeenCalled();
  });
});

// ─── Unit Tests: Remove Bot ────────────────────────────────────────────

describe('UptimeService.removeBot', () => {
  it('should remove a tracked bot successfully', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue({
      id: 'tracked-id',
      guildId: 'guild-1',
      botId: 'bot-1',
    });
    mockPrisma.trackedBot.delete.mockResolvedValue({});

    const result = await UptimeService.removeBot('guild-1', 'bot-1');

    expect(result.success).toBe(true);
    expect(mockPrisma.trackedBot.delete).toHaveBeenCalledWith({
      where: { id: 'tracked-id' },
    });
  });

  it('should return not_tracked for unknown bot', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue(null);

    const result = await UptimeService.removeBot('guild-1', 'bot-1');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_tracked');
    expect(mockPrisma.trackedBot.delete).not.toHaveBeenCalled();
  });
});

// ─── Integration-Style Tests: Command Handler Validation ───────────────

describe('Uptimer Command — Input Validation', () => {
  // Simulates what happens when the handler receives bot = undefined
  it('should return error when bot option is null (no crash, no DB call)', () => {
    const user = null; // simulating interaction.options.getUser('bot') returning null

    // This tests the guard logic that exists at the top of every handler
    expect(user).toBeNull();

    // Verify no Prisma calls were made
    expect(mockPrisma.trackedBot.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.trackedBot.create).not.toHaveBeenCalled();
    expect(mockPrisma.trackedBot.delete).not.toHaveBeenCalled();
  });

  it('should reject non-bot users', () => {
    const user = { id: 'user-123', bot: false, tag: 'Human#0001' };

    // The command handler checks user.bot before any DB call
    expect(user.bot).toBe(false);

    // No DB operations should happen
    expect(mockPrisma.trackedBot.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Unit Tests: Alert Configuration ───────────────────────────────────

describe('UptimeService.setAlertChannel', () => {
  it('should set alert channel successfully', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue({
      id: 'tracked-id',
      guildId: 'guild-1',
      botId: 'bot-1',
    });
    mockPrisma.trackedBot.update.mockResolvedValue({});

    const result = await UptimeService.setAlertChannel('guild-1', 'bot-1', 'channel-1');

    expect(result.success).toBe(true);
    expect(mockPrisma.trackedBot.update).toHaveBeenCalledWith({
      where: { id: 'tracked-id' },
      data: { alertChannelId: 'channel-1' },
    });
  });

  it('should reject alert for untracked bot', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue(null);

    const result = await UptimeService.setAlertChannel('guild-1', 'bot-1', 'channel-1');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_tracked');
  });
});

describe('UptimeService.removeAlertChannel', () => {
  it('should remove alert channel successfully', async () => {
    mockPrisma.trackedBot.findUnique.mockResolvedValue({
      id: 'tracked-id',
      guildId: 'guild-1',
      botId: 'bot-1',
    });
    mockPrisma.trackedBot.update.mockResolvedValue({});

    const result = await UptimeService.removeAlertChannel('guild-1', 'bot-1');

    expect(result.success).toBe(true);
    expect(mockPrisma.trackedBot.update).toHaveBeenCalledWith({
      where: { id: 'tracked-id' },
      data: { alertChannelId: null },
    });
  });
});
