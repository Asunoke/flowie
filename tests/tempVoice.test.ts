import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma & Logger ──────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    tempVoiceSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    tempVoiceChannel: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    guild: {
      findUnique: vi.fn(),
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

import { TempVoiceService } from '../src/services/tempVoiceService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit Tests: Settings & DB Persistence ─────────────────────────────────

describe('TempVoiceService — Settings Management', () => {
  it('should fetch temp voice settings for a guild', async () => {
    const mockSettings = {
      guildId: 'guild-123',
      triggerChannelId: 'trigger-voice-id',
      categoryId: 'category-id',
      nameTemplate: '🔊 Salon de {user}',
      maxChannels: 50,
      enabled: true,
    };
    mockPrisma.tempVoiceSettings.findUnique.mockResolvedValue(mockSettings);

    const res = await TempVoiceService.getSettings('guild-123');

    expect(mockPrisma.tempVoiceSettings.findUnique).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
    });
    expect(res).toEqual(mockSettings);
  });

  it('should save/upsert temp voice settings', async () => {
    const data = {
      guildId: 'guild-123',
      triggerChannelId: 'trigger-voice-id',
      categoryId: 'category-id',
      nameTemplate: '🔊 Salon de {user}',
      maxChannels: 50,
      enabled: true,
    };
    mockPrisma.tempVoiceSettings.upsert.mockResolvedValue(data);

    const res = await TempVoiceService.saveSettings(data);

    expect(mockPrisma.tempVoiceSettings.upsert).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
      create: data,
      update: {
        triggerChannelId: 'trigger-voice-id',
        categoryId: 'category-id',
        nameTemplate: '🔊 Salon de {user}',
        maxChannels: 50,
        enabled: true,
      },
    });
    expect(res).toEqual(data);
  });

  it('should disable temp voice module for a guild', async () => {
    mockPrisma.tempVoiceSettings.update.mockResolvedValue({ guildId: 'guild-123', enabled: false });

    const res = await TempVoiceService.disableTempVoice('guild-123');

    expect(mockPrisma.tempVoiceSettings.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
      data: { enabled: false },
    });
    expect(res.enabled).toBe(false);
  });
});

// ─── Unit Tests: Channel Creation & Limits ─────────────────────────────────

describe('TempVoiceService — Creation & Limits', () => {
  it('should prevent creating a new channel if user already has an active channel', async () => {
    const existingRecord = { channelId: 'channel-existing', ownerId: 'user-123' };
    mockPrisma.tempVoiceChannel.findFirst.mockResolvedValue(existingRecord);

    const mockVoiceChannel = { id: 'channel-existing', isVoiceBased: () => true };
    const mockGuild = {
      id: 'guild-123',
      channels: { cache: new Map([['channel-existing', mockVoiceChannel]]) },
    } as any;
    const mockMember = { id: 'user-123', voice: { channelId: 'trigger-id', setChannel: vi.fn().mockResolvedValue({}) } } as any;

    const res = await TempVoiceService.createTempChannel(mockGuild, mockMember);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('already_exists');
    expect(res.existingChannelId).toBe('channel-existing');
    expect(mockMember.voice.setChannel).toHaveBeenCalledWith(mockVoiceChannel);
  });

  it('should prevent creating a channel if guild limit is reached', async () => {
    mockPrisma.tempVoiceChannel.findFirst.mockResolvedValue(null);
    mockPrisma.tempVoiceSettings.findUnique.mockResolvedValue({
      enabled: true,
      maxChannels: 5,
    });
    mockPrisma.tempVoiceChannel.count.mockResolvedValue(5); // 5 channels active

    const mockGuild = { id: 'guild-123' } as any;
    const mockMember = { id: 'user-123' } as any;

    const res = await TempVoiceService.createTempChannel(mockGuild, mockMember);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('limit_reached');
    expect(res.limit).toBe(5);
  });
});

// ─── Unit Tests: Ownership & Control Guards ─────────────────────────────────

describe('TempVoiceService — Ownership & Controls', () => {
  it('should validate owner or staff permissions', async () => {
    mockPrisma.guild.findUnique.mockResolvedValue({ ticketStaffRoleId: 'staff-role-id' });
    mockPrisma.tempVoiceChannel.findUnique.mockResolvedValue({ ownerId: 'user-owner' });

    const ownerMember = {
      id: 'user-owner',
      permissions: { has: () => false },
      roles: { cache: new Map() },
    } as any;

    const nonOwnerMember = {
      id: 'user-other',
      permissions: { has: () => false },
      roles: { cache: new Map() },
    } as any;

    const staffMember = {
      id: 'user-staff',
      permissions: { has: () => false },
      roles: { cache: new Map([['staff-role-id', {}]]) },
    } as any;

    const mockGuild = { id: 'guild-123' } as any;

    expect(await TempVoiceService.isOwnerOrStaff(mockGuild, ownerMember, 'temp-channel-id')).toBe(true);
    expect(await TempVoiceService.isOwnerOrStaff(mockGuild, nonOwnerMember, 'temp-channel-id')).toBe(false);
    expect(await TempVoiceService.isOwnerOrStaff(mockGuild, staffMember, 'temp-channel-id')).toBe(true);
  });

  it('should transfer ownership to a new member', async () => {
    mockPrisma.tempVoiceChannel.findUnique.mockResolvedValue({ ownerId: 'old-owner-id' });
    mockPrisma.tempVoiceChannel.update.mockResolvedValue({});

    const mockEdit = vi.fn().mockResolvedValue({});
    const mockDelete = vi.fn().mockResolvedValue({});

    const mockChannel = {
      id: 'temp-channel-id',
      permissionOverwrites: {
        edit: mockEdit,
        delete: mockDelete,
      },
    } as any;

    const oldOwnerMember = { id: 'old-owner-id' };
    const newOwnerMember = { id: 'new-owner-id' };

    const mockGuild = {
      id: 'guild-123',
      members: {
        fetch: vi.fn().mockImplementation((id: string) =>
          Promise.resolve(id === 'old-owner-id' ? oldOwnerMember : newOwnerMember)
        ),
      },
    } as any;

    const result = await TempVoiceService.transferOwnership(mockGuild, mockChannel, newOwnerMember as any);

    expect(result).toBe(true);
    expect(mockPrisma.tempVoiceChannel.update).toHaveBeenCalledWith({
      where: { channelId: 'temp-channel-id' },
      data: { ownerId: 'new-owner-id' },
    });
    expect(mockEdit).toHaveBeenCalledWith(newOwnerMember, expect.objectContaining({ ManageChannels: true }));
  });

  it('should allow claiming channel if original owner is not in channel', async () => {
    mockPrisma.tempVoiceChannel.findUnique.mockResolvedValue({ ownerId: 'absent-owner-id' });
    mockPrisma.tempVoiceChannel.update.mockResolvedValue({});

    const claimerMember = { id: 'user-claimer' } as any;
    const mockChannel = {
      id: 'temp-channel-id',
      members: new Map([['user-claimer', claimerMember]]), // original owner absent!
      permissionOverwrites: { edit: vi.fn(), delete: vi.fn() },
    } as any;

    const mockGuild = {
      id: 'guild-123',
      members: { fetch: vi.fn().mockResolvedValue(null) },
    } as any;

    const res = await TempVoiceService.claimOwnership(mockGuild, mockChannel, claimerMember);

    expect(res.success).toBe(true);
  });
});
