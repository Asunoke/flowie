import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma & Logger ──────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    guild: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
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

import { TicketService } from '../src/services/ticketService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit Tests: Ticket Limit ──────────────────────────────────────────────

describe('TicketService — Limit Checks', () => {
  it('should prevent opening ticket if user limit is reached', async () => {
    mockPrisma.guild.findUnique.mockResolvedValue({
      id: 'guild-123',
      ticketLimit: 1,
    });

    mockPrisma.ticket.count.mockResolvedValue(1); // 1 open ticket already

    const mockGuild = { id: 'guild-123', channels: { create: vi.fn() }, roles: { everyone: { id: 'everyone-id' } } } as any;
    const mockMember = { id: 'user-123', user: { username: 'testuser', tag: 'testuser#0001' } } as any;

    const result = await TicketService.openTicket(mockGuild, mockMember, 'Support');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('limit_reached');
    expect(result.limit).toBe(1);
    expect(mockGuild.channels.create).not.toHaveBeenCalled();
  });
});

// ─── Unit Tests: Ticket Stats ─────────────────────────────────────────────

describe('TicketService — Statistics Computation', () => {
  it('should correctly calculate metrics for 24h period', async () => {
    const now = Date.now();
    const createdAt = new Date(now - 10 * 60 * 1000); // 10 minutes ago
    const firstResponseAt = new Date(now - 5 * 60 * 1000); // 5 minutes after creation

    const sampleTickets = [
      {
        id: 't-1',
        guildId: 'guild-123',
        ownerId: 'user-1',
        type: 'Support',
        status: 'closed',
        claimedBy: 'staff-1',
        firstResponseAt,
        createdAt,
        closedAt: new Date(),
        closedBy: 'staff-1',
      },
      {
        id: 't-2',
        guildId: 'guild-123',
        ownerId: 'user-2',
        type: 'Signalement',
        status: 'open',
        claimedBy: null,
        firstResponseAt: null,
        createdAt,
        closedAt: null,
        closedBy: null,
      },
    ];

    mockPrisma.ticket.findMany.mockResolvedValue(sampleTickets);

    const stats = await TicketService.getTicketStats('guild-123', '24h');

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(2);
    expect(stats?.open).toBe(1);
    expect(stats?.closed).toBe(1);
    expect(stats?.typeCounts['Support']).toBe(1);
    expect(stats?.typeCounts['Signalement']).toBe(1);
    // Response time: 5 mins = 300,000 ms
    expect(stats?.avgResponseTimeMs).toBe(5 * 60 * 1000);
    expect(stats?.staffLeaderboard[0]).toEqual({ staffId: 'staff-1', count: 1 });
  });
});

// ─── Unit Tests: Channel Delete Listener ────────────────────────────────────

describe('TicketService — Channel Delete Cleanup', () => {
  it('should mark ticket as closed when channel is deleted', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: 'ticket-777',
      guildId: 'guild-123',
      ownerId: 'user-888',
      status: 'open',
    });

    mockPrisma.guild.findUnique.mockResolvedValue({ id: 'guild-123', ticketLogsChannelId: null });
    mockPrisma.ticket.update.mockResolvedValue({});

    const mockChannel = {
      id: 'channel-777',
      name: 'ticket-test',
      guild: { id: 'guild-123', channels: { cache: new Map() } },
    } as any;

    await TicketService.handleChannelDelete(mockChannel);

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-777' },
      data: {
        status: 'closed',
        closedAt: expect.any(Date),
        closeReason: 'Salon supprimé manuellement',
      },
    });
  });
});
