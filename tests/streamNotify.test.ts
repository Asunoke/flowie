import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    streamSubscription: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
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

import { TwitchService } from '../src/services/twitchService.js';
import { YouTubeService } from '../src/services/youtubeService.js';
import { StreamNotifyService } from '../src/services/streamNotifyService.js';
import { prisma } from '../src/database/db.js';
import { config } from '../src/config/index.js';

describe('Stream & Video Notification Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. TwitchService Tests ──────────────────────────────────────────────────

  describe('TwitchService', () => {
    it('should report false for isConfigured when client ID/secret are empty', () => {
      config.stream.twitchClientId = '';
      config.stream.twitchClientSecret = '';
      expect(TwitchService.isConfigured()).toBe(false);
    });

    it('should report true for isConfigured when client ID/secret are provided', () => {
      config.stream.twitchClientId = 'mock-client-id';
      config.stream.twitchClientSecret = 'mock-client-secret';
      expect(TwitchService.isConfigured()).toBe(true);
    });

    it('should fetch OAuth token and parse streams batch response', async () => {
      config.stream.twitchClientId = 'test-id';
      config.stream.twitchClientSecret = 'test-secret';

      const mockTokenResponse = {
        access_token: 'mock-access-token',
        expires_in: 3600,
        token_type: 'bearer',
      };

      const mockStreamsResponse = {
        data: [
          {
            id: 'stream-999',
            user_id: '12345',
            user_login: 'kameto',
            user_name: 'Kameto',
            game_name: 'League of Legends',
            title: 'KCORP vs G2 !',
            viewer_count: 25000,
            started_at: '2026-08-26T10:00:00Z',
            thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_kameto-{width}x{height}.jpg',
          },
        ],
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2/token')) {
          return { ok: true, json: async () => mockTokenResponse } as any;
        }
        if (url.includes('helix/streams')) {
          return { ok: true, json: async () => mockStreamsResponse } as any;
        }
        return { ok: false } as any;
      });

      const streams = await TwitchService.getStreams(['kameto']);

      expect(streams).toHaveLength(1);
      expect(streams[0]).toEqual({
        id: 'stream-999',
        userId: '12345',
        userLogin: 'kameto',
        userName: 'Kameto',
        gameName: 'League of Legends',
        title: 'KCORP vs G2 !',
        viewerCount: 25000,
        startedAt: '2026-08-26T10:00:00Z',
        thumbnailUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_kameto-1280x720.jpg',
      });

      global.fetch = originalFetch;
    });
  });

  // ─── 2. YouTubeService Tests ─────────────────────────────────────────────────

  describe('YouTubeService', () => {
    it('should recognize direct Channel ID starting with UC and 24 chars', async () => {
      const channelId = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw';
      const result = await YouTubeService.resolveChannel(channelId);

      expect(result).not.toBeNull();
      expect(result?.channelId).toBe(channelId);
    });
  });

  // ─── 3. StreamNotifyService Tests ────────────────────────────────────────────

  describe('StreamNotifyService', () => {
    it('should correctly format custom message variables', () => {
      const template = '🔴 Live de {streamer} ! Titre: "{title}" sur {game}. Regarder: {url}';
      const formatted = StreamNotifyService.formatMessage(template, {
        streamer: 'Gotaga',
        title: 'Session Fortnite',
        game: 'Fortnite',
        url: 'https://twitch.tv/gotaga',
      });

      expect(formatted).toBe(
        '🔴 Live de Gotaga ! Titre: "Session Fortnite" sur Fortnite. Regarder: https://twitch.tv/gotaga'
      );
    });

    it('should throw an error when guild exceeds subscription limit', async () => {
      vi.mocked(prisma.streamSubscription.count).mockResolvedValue(10 as never);

      await expect(
        StreamNotifyService.addSubscription(
          'guild-123',
          'chan-456',
          'twitch',
          'kameto'
        )
      ).rejects.toThrow(/Limite d'abonnements atteinte/);
    });

    it('should create new subscription when under limit', async () => {
      vi.mocked(prisma.streamSubscription.count).mockResolvedValue(2 as never);
      vi.mocked(prisma.streamSubscription.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.streamSubscription.create).mockResolvedValue({
        id: 'sub-1',
        guildId: 'guild-123',
        channelId: 'chan-456',
        platform: 'twitch',
        targetHandle: 'kameto',
        targetId: '12345',
        customMessage: null,
        lastNotifiedId: null,
        createdAt: new Date(),
      } as never);

      const sub = await StreamNotifyService.addSubscription(
        'guild-123',
        'chan-456',
        'twitch',
        'kameto',
        '12345'
      );

      expect(prisma.streamSubscription.create).toHaveBeenCalledWith({
        data: {
          guildId: 'guild-123',
          channelId: 'chan-456',
          platform: 'twitch',
          targetHandle: 'kameto',
          targetId: '12345',
          customMessage: null,
        },
      });
      expect(sub.id).toBe('sub-1');
    });

    it('should remove an active subscription', async () => {
      vi.mocked(prisma.streamSubscription.deleteMany).mockResolvedValue({ count: 1 } as never);

      const success = await StreamNotifyService.removeSubscription('guild-123', 'twitch', 'kameto');

      expect(success).toBe(true);
      expect(prisma.streamSubscription.deleteMany).toHaveBeenCalledWith({
        where: {
          guildId: 'guild-123',
          platform: 'twitch',
          targetHandle: 'kameto',
        },
      });
    });

    it('should list active subscriptions for a guild', async () => {
      const mockList = [
        { id: 'sub-1', platform: 'twitch', targetHandle: 'kameto', channelId: 'c1' },
        { id: 'sub-2', platform: 'youtube', targetHandle: '@jdg', channelId: 'c2' },
      ];
      vi.mocked(prisma.streamSubscription.findMany).mockResolvedValue(mockList as never);

      const result = await StreamNotifyService.listSubscriptions('guild-123');

      expect(result).toHaveLength(2);
      expect(prisma.streamSubscription.findMany).toHaveBeenCalledWith({
        where: { guildId: 'guild-123', platform: undefined },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
