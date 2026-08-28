import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    guild: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// ─── Mock WelcomeCardService ──────────────────────────────────────────────────
vi.mock('../src/services/welcomeCardService.js', () => ({
  WelcomeCardService: {
    generateWelcomeCard: vi.fn().mockResolvedValue(Buffer.from('fake-welcome-png')),
    generateLeaveCard: vi.fn().mockResolvedValue(Buffer.from('fake-leave-png')),
  },
}));

import { command } from '../src/commands/management/welcome.ts';
import { prisma } from '../src/database/db.js';
import { WelcomeCardService } from '../src/services/welcomeCardService.js';

describe('Welcome Command - Test Subcommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send welcome test message to configured welcome channel', async () => {
    const mockChannel = {
      id: 'welcome-chan-1',
      isTextBased: () => true,
      send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };

    const mockGuild = {
      id: 'guild-100',
      name: 'Server Test',
      memberCount: 42,
      channels: {
        cache: new Map([['welcome-chan-1', mockChannel]]),
      },
    };

    const mockMember = {
      user: { tag: 'Admin#0001' },
      guild: mockGuild,
      toString: () => '<@123456>',
    };

    const mockInteraction = {
      guild: mockGuild,
      member: mockMember,
      channel: mockChannel,
      options: {
        getSubcommand: () => 'test-welcome',
        getString: () => null,
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(prisma.guild.findUnique).mockResolvedValue({
      id: 'guild-100',
      welcomeEnabled: true,
      welcomeChannelId: 'welcome-chan-1',
      welcomeMessage: 'Bienvenue {user} sur {server} !',
      welcomeBgUrl: null,
      leaveEnabled: true,
      leaveChannelId: null,
      leaveMessage: null,
      leaveBgUrl: null,
    } as never);

    await command.execute(mockInteraction as never);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(WelcomeCardService.generateWelcomeCard).toHaveBeenCalledWith(mockMember, null);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '<@123456>',
        embeds: expect.any(Array),
        files: expect.any(Array),
      })
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should send leave test message to configured leave channel', async () => {
    const mockLeaveChannel = {
      id: 'leave-chan-2',
      isTextBased: () => true,
      send: vi.fn().mockResolvedValue({ id: 'msg-2' }),
    };

    const mockGuild = {
      id: 'guild-100',
      name: 'Server Test',
      memberCount: 41,
      channels: {
        cache: new Map([['leave-chan-2', mockLeaveChannel]]),
      },
    };

    const mockMember = {
      user: { tag: 'Admin#0001' },
      guild: mockGuild,
      toString: () => '<@123456>',
    };

    const mockInteraction = {
      guild: mockGuild,
      member: mockMember,
      channel: mockLeaveChannel,
      options: {
        getSubcommand: () => 'test-leave',
        getString: () => null,
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(prisma.guild.findUnique).mockResolvedValue({
      id: 'guild-100',
      welcomeEnabled: true,
      welcomeChannelId: 'welcome-chan-1',
      welcomeMessage: null,
      welcomeBgUrl: null,
      leaveEnabled: true,
      leaveChannelId: 'leave-chan-2',
      leaveMessage: '{user} a quitté {server} ({membercount} membres restantes)',
      leaveBgUrl: 'https://example.com/bg.png',
    } as never);

    await command.execute(mockInteraction as never);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(WelcomeCardService.generateLeaveCard).toHaveBeenCalledWith(mockMember, 'https://example.com/bg.png');
    expect(mockLeaveChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        files: expect.any(Array),
      })
    );
  });
});
