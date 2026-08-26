import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    countingGame: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
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

import { CountingService } from '../src/services/countingService.js';
import { prisma } from '../src/database/db.js';

function makeMockMessage(content: string, authorId: string = 'user-1') {
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: 'guild-123' },
    channel: { id: 'chan-999', isTextBased: () => true, send: vi.fn().mockResolvedValue({}) },
    react: vi.fn().mockResolvedValue({}),
  };
}

describe('CountingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setup & disable', () => {
    it('should upsert counting game configuration in DB', async () => {
      vi.mocked(prisma.countingGame.upsert).mockResolvedValue({} as never);

      await CountingService.setup('guild-123', 'chan-999');

      expect(prisma.countingGame.upsert).toHaveBeenCalledWith({
        where: { guildId: 'guild-123' },
        create: {
          guildId: 'guild-123',
          channelId: 'chan-999',
          currentCount: 0,
          lastUserId: null,
          highestRecord: 0,
          enabled: true,
        },
        update: {
          channelId: 'chan-999',
          enabled: true,
        },
      });
    });

    it('should disable game when record exists', async () => {
      vi.mocked(prisma.countingGame.findUnique).mockResolvedValue({ id: 'game-1' } as never);
      vi.mocked(prisma.countingGame.update).mockResolvedValue({} as never);

      const success = await CountingService.disable('guild-123');

      expect(success).toBe(true);
      expect(prisma.countingGame.update).toHaveBeenCalledWith({
        where: { guildId: 'guild-123' },
        data: { enabled: false },
      });
    });
  });

  describe('handleMessage', () => {
    it('should accept valid next number from a different user and react with ✅', async () => {
      const mockGame = {
        id: 'game-1',
        guildId: 'guild-123',
        channelId: 'chan-999',
        currentCount: 5,
        lastUserId: 'user-previous',
        highestRecord: 10,
        enabled: true,
      };

      vi.mocked(prisma.countingGame.findFirst).mockResolvedValue(mockGame as never);
      vi.mocked(prisma.countingGame.update).mockResolvedValue({} as never);

      const msg = makeMockMessage('6', 'user-new');
      const handled = await CountingService.handleMessage(msg as never);

      expect(handled).toBe(true);
      expect(msg.react).toHaveBeenCalledWith('✅');
      expect(prisma.countingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: {
          currentCount: 6,
          lastUserId: 'user-new',
          highestRecord: 10,
        },
      });
    });

    it('should reject when the same user attempts to count twice in a row', async () => {
      const mockGame = {
        id: 'game-1',
        guildId: 'guild-123',
        channelId: 'chan-999',
        currentCount: 5,
        lastUserId: 'user-same',
        highestRecord: 10,
        enabled: true,
      };

      vi.mocked(prisma.countingGame.findFirst).mockResolvedValue(mockGame as never);
      vi.mocked(prisma.countingGame.update).mockResolvedValue({} as never);

      const msg = makeMockMessage('6', 'user-same');
      const handled = await CountingService.handleMessage(msg as never);

      expect(handled).toBe(true);
      expect(msg.react).toHaveBeenCalledWith('❌');
      expect(prisma.countingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: {
          currentCount: 0,
          lastUserId: null,
        },
      });
      expect(msg.channel.send).toHaveBeenCalled();
    });

    it('should reject and reset to 0 when a wrong number is provided', async () => {
      const mockGame = {
        id: 'game-1',
        guildId: 'guild-123',
        channelId: 'chan-999',
        currentCount: 5,
        lastUserId: 'user-prev',
        highestRecord: 10,
        enabled: true,
      };

      vi.mocked(prisma.countingGame.findFirst).mockResolvedValue(mockGame as never);
      vi.mocked(prisma.countingGame.update).mockResolvedValue({} as never);

      const msg = makeMockMessage('99', 'user-new');
      const handled = await CountingService.handleMessage(msg as never);

      expect(handled).toBe(true);
      expect(msg.react).toHaveBeenCalledWith('❌');
      expect(prisma.countingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: {
          currentCount: 0,
          lastUserId: null,
        },
      });
    });

    it('should update highestRecord when current count exceeds previous record', async () => {
      const mockGame = {
        id: 'game-1',
        guildId: 'guild-123',
        channelId: 'chan-999',
        currentCount: 10,
        lastUserId: 'user-prev',
        highestRecord: 10,
        enabled: true,
      };

      vi.mocked(prisma.countingGame.findFirst).mockResolvedValue(mockGame as never);
      vi.mocked(prisma.countingGame.update).mockResolvedValue({} as never);

      const msg = makeMockMessage('11', 'user-new');
      await CountingService.handleMessage(msg as never);

      expect(prisma.countingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: {
          currentCount: 11,
          lastUserId: 'user-new',
          highestRecord: 11,
        },
      });
    });
  });
});
