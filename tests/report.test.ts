import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock discord.js ───────────────────────────────────────────────────────
vi.mock('discord.js', () => {
  const mockRow = {
    addComponents: vi.fn().mockReturnThis(),
    toJSON: vi.fn().mockReturnValue({}),
  };
  const mockBtn = {
    setCustomId: vi.fn().mockReturnThis(),
    setLabel: vi.fn().mockReturnThis(),
    setStyle: vi.fn().mockReturnThis(),
    setEmoji: vi.fn().mockReturnThis(),
    setDisabled: vi.fn().mockReturnThis(),
    toJSON: vi.fn().mockReturnValue({}),
  };
  return {
    ActionRowBuilder: vi.fn(() => mockRow),
    ButtonBuilder: vi.fn(() => mockBtn),
    ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Warning: 3 },
    Guild: class {},
    TextChannel: class {},
    Message: class {},
  };
});

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    report: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    reportConfig: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    warning: {
      create: vi.fn(),
    },
  },
}));

// ─── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../src/services/redisService.js', () => ({
  redis: {
    ttl: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  },
}));

// ─── Mock EmbedService ───────────────────────────────────────────────────────
vi.mock('../src/services/embedService.js', () => {
  const mockEmbed = {
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    setTimestamp: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
  };
  return {
    EmbedService: {
      warning: vi.fn(() => mockEmbed),
      create: vi.fn(() => mockEmbed),
      success: vi.fn(() => mockEmbed),
      error: vi.fn(() => mockEmbed),
    },
  };
});

// ─── Mock Logger ──────────────────────────────────────────────────────────────
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { ReportService } from '../src/services/reportService.js';
import { prisma } from '../src/database/db.js';
import { redis } from '../src/services/redisService.js';

function makeMockGuild() {
  const channel = {
    id: 'chan-staff',
    isTextBased: () => true,
    send: vi.fn().mockResolvedValue({ id: 'msg-staff-99' }),
  };

  return {
    id: 'guild-777',
    name: 'Test Server',
    channels: {
      cache: new Map([['chan-staff', channel]]),
    },
    members: {
      fetch: vi.fn().mockResolvedValue({
        moderatable: true,
        timeout: vi.fn().mockResolvedValue({}),
      }),
    },
  };
}

describe('ReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createReport', () => {
    it('should throw error if user tries to report themselves', async () => {
      const guild = makeMockGuild();

      await expect(
        ReportService.createReport(guild as never, 'user-1', 'user-1', 'Self report')
      ).rejects.toThrow(/vous-même/);
    });

    it('should throw error if report system is not configured', async () => {
      vi.mocked(prisma.reportConfig.findUnique).mockResolvedValue(null);
      const guild = makeMockGuild();

      await expect(
        ReportService.createReport(guild as never, 'user-1', 'user-2', 'Spam')
      ).rejects.toThrow(/pas encore configuré/);
    });

    it('should throw error if user is under cooldown', async () => {
      vi.mocked(prisma.reportConfig.findUnique).mockResolvedValue({
        id: 'cfg-1',
        guildId: 'guild-777',
        channelId: 'chan-staff',
        enabled: true,
      } as never);
      vi.mocked(redis.ttl).mockResolvedValue(120 as never); // 2 minutes left

      const guild = makeMockGuild();

      await expect(
        ReportService.createReport(guild as never, 'user-1', 'user-2', 'Insultes')
      ).rejects.toThrow(/Veuillez patienter/);
    });

    it('should create report, post to staff channel, and set 5 min cooldown', async () => {
      vi.mocked(prisma.reportConfig.findUnique).mockResolvedValue({
        id: 'cfg-1',
        guildId: 'guild-777',
        channelId: 'chan-staff',
        enabled: true,
      } as never);
      vi.mocked(redis.ttl).mockResolvedValue(-2 as never);
      vi.mocked(prisma.report.create).mockResolvedValue({
        id: 'rep-abc123456',
        createdAt: new Date(),
      } as never);
      vi.mocked(prisma.report.update).mockResolvedValue({} as never);
      vi.mocked(redis.set).mockResolvedValue('OK' as never);

      const guild = makeMockGuild();
      const report = await ReportService.createReport(
        guild as never,
        'reporter-1',
        'suspect-2',
        'Comportement toxique',
        'https://example.com/proof.png'
      );

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          guildId: 'guild-777',
          reporterId: 'reporter-1',
          reportedId: 'suspect-2',
          reason: 'Comportement toxique',
          proofUrl: 'https://example.com/proof.png',
          status: 'pending',
        },
      });
      expect(redis.set).toHaveBeenCalledWith('report:cooldown:guild-777:reporter-1', '1', 'EX', 300);
      expect(report.id).toBe('rep-abc123456');
    });
  });

  describe('handleReportAction', () => {
    it('should update report status to warned and issue warning in DB', async () => {
      const mockReport = {
        id: 'rep-abc123456',
        guildId: 'guild-777',
        reportedId: 'suspect-2',
        reason: 'Insultes',
      };
      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport as never);
      vi.mocked(prisma.report.update).mockResolvedValue({} as never);
      vi.mocked(prisma.warning.create).mockResolvedValue({} as never);


      const guild = makeMockGuild();
      const mockMessage = {
        embeds: [{ title: '🚨 Signalement' }],
        edit: vi.fn().mockResolvedValue({}),
      };

      await ReportService.handleReportAction(
        'rep-abc123456',
        'staff-1',
        'warn',
        guild as never,
        mockMessage as never
      );

      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 'rep-abc123456' },
        data: { status: 'warned' },
      });
      expect(prisma.warning.create).toHaveBeenCalled();
      expect(mockMessage.edit).toHaveBeenCalled();
    });
  });
});
