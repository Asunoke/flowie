import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma, Redis & Logger ───────────────────────────────────────────

const { mockPrisma, mockRedis, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    verifySettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    guild: {
      findUnique: vi.fn(),
    },
  },
  mockRedis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
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

vi.mock('../src/services/redisService.js', () => ({
  redis: mockRedis,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { VerifyService } from '../src/services/verifyService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit Tests: Settings & Database Management ────────────────────────────

describe('VerifyService — Settings Management', () => {
  it('should fetch verify settings for a guild', async () => {
    const mockSettings = {
      guildId: 'guild-123',
      verifyChannelId: 'channel-1',
      verifiedRoleId: 'role-verified',
      unverifiedRoleId: 'role-unverified',
      enabled: true,
    };
    mockPrisma.verifySettings.findUnique.mockResolvedValue(mockSettings);

    const res = await VerifyService.getSettings('guild-123');

    expect(mockPrisma.verifySettings.findUnique).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
    });
    expect(res).toEqual(mockSettings);
  });

  it('should save/upsert verify settings', async () => {
    const data = {
      guildId: 'guild-123',
      verifyChannelId: 'channel-1',
      verifiedRoleId: 'role-verified',
      unverifiedRoleId: 'role-unverified',
      enabled: true,
    };
    mockPrisma.verifySettings.upsert.mockResolvedValue(data);

    const res = await VerifyService.saveSettings(data);

    expect(mockPrisma.verifySettings.upsert).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
      create: data,
      update: {
        verifyChannelId: 'channel-1',
        verifiedRoleId: 'role-verified',
        unverifiedRoleId: 'role-unverified',
        enabled: true,
      },
    });
    expect(res).toEqual(data);
  });

  it('should disable verification for a guild', async () => {
    mockPrisma.verifySettings.findUnique.mockResolvedValue({ guildId: 'guild-123', enabled: true });
    mockPrisma.verifySettings.update.mockResolvedValue({ guildId: 'guild-123', enabled: false });

    const res = await VerifyService.disableVerification('guild-123');

    expect(mockPrisma.verifySettings.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-123' },
      data: { enabled: false },
    });
    expect(res?.enabled).toBe(false);
  });
});

// ─── Unit Tests: Role & Permission Helpers ─────────────────────────────────

describe('VerifyService — Role Management', () => {
  it('should return existing unverified role if found', async () => {
    const mockRole = { id: 'role-unverified', name: 'Non vérifié' };
    const mockGuild = {
      roles: {
        cache: [mockRole],
        create: vi.fn(),
      },
    } as any;

    const role = await VerifyService.ensureUnverifiedRole(mockGuild);

    expect(role).toEqual(mockRole);
    expect(mockGuild.roles.create).not.toHaveBeenCalled();
  });

  it('should create new "Non vérifié" role if not found', async () => {
    const createdRole = { id: 'role-new', name: 'Non vérifié' };
    const mockGuild = {
      roles: {
        cache: [],
        create: vi.fn().mockResolvedValue(createdRole),
      },
    } as any;

    const role = await VerifyService.ensureUnverifiedRole(mockGuild);

    expect(mockGuild.roles.create).toHaveBeenCalledWith({
      name: 'Non vérifié',
      color: 0x7f8c8d,
      permissions: [],
      reason: expect.any(String),
    });
    expect(role).toEqual(createdRole);
  });
});

// ─── Unit Tests: Captcha Generation & Verification ────────────────────────

describe('VerifyService — Captcha Verification Flow', () => {
  it('should generate captcha and store code in Redis', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const result = await VerifyService.generateCaptcha('guild-123', 'user-456');

    expect(result.promptText).toBeDefined();
    expect(result.expectedAnswer).toBeDefined();
    expect(mockRedis.set).toHaveBeenCalledWith(
      'verify:captcha:guild-123:user-456',
      result.expectedAnswer,
      'EX',
      300
    );
  });

  it('should reject verification if user is on cooldown', async () => {
    mockRedis.ttl.mockResolvedValue(45); // 45 seconds remaining

    const mockGuild = { id: 'guild-123' } as any;
    const mockMember = { id: 'user-456' } as any;

    const result = await VerifyService.verifyAnswer(mockGuild, mockMember, 'CODE12');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('cooldown');
    expect(result.remainingSeconds).toBe(45);
  });

  it('should successfully verify user with correct captcha code', async () => {
    mockRedis.ttl.mockResolvedValue(0);
    mockRedis.get.mockResolvedValue('SECRETCODE');
    mockPrisma.verifySettings.findUnique.mockResolvedValue({
      unverifiedRoleId: 'role-unverified',
      verifiedRoleId: 'role-verified',
    });
    mockPrisma.guild.findUnique.mockResolvedValue({ logChannelId: null });

    const removeFn = vi.fn().mockResolvedValue({});
    const addFn = vi.fn().mockResolvedValue({});

    const mockRoleVerified = { id: 'role-verified' };
    const mockGuild = {
      id: 'guild-123',
      roles: {
        cache: {
          get: (id: string) => (id === 'role-verified' ? mockRoleVerified : null),
        },
      },
      channels: { cache: { get: vi.fn() } },
    } as any;

    const mockMember = {
      id: 'user-456',
      user: { tag: 'testuser#0001', displayAvatarURL: () => 'http://avatar.jpg' },
      roles: {
        cache: { has: (id: string) => id === 'role-unverified' },
        remove: removeFn,
        add: addFn,
      },
    } as any;

    const result = await VerifyService.verifyAnswer(mockGuild, mockMember, 'secretcode');

    expect(result.success).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith('verify:captcha:guild-123:user-456');
    expect(mockRedis.del).toHaveBeenCalledWith('verify:attempts:guild-123:user-456');
    expect(removeFn).toHaveBeenCalledWith('role-unverified');
    expect(addFn).toHaveBeenCalledWith(mockRoleVerified);
  });

  it('should handle incorrect code and trigger cooldown after 5 failed attempts', async () => {
    mockRedis.ttl.mockResolvedValue(0);
    mockRedis.get.mockImplementation((key: string) => {
      if (key.startsWith('verify:captcha:')) return Promise.resolve('CORRECTCODE');
      if (key.startsWith('verify:attempts:')) return Promise.resolve('4'); // 4 previous attempts
      return Promise.resolve(null);
    });
    mockPrisma.guild.findUnique.mockResolvedValue({ logChannelId: null });

    const mockGuild = { id: 'guild-123', channels: { cache: { get: vi.fn() } } } as any;
    const mockMember = {
      id: 'user-456',
      user: { tag: 'testuser#0001', displayAvatarURL: () => 'http://avatar.jpg' },
    } as any;

    const result = await VerifyService.verifyAnswer(mockGuild, mockMember, 'WRONGCODE');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('incorrect');
    expect(result.attempts).toBe(5);
    expect(result.onCooldown).toBe(true);
    expect(result.remainingSeconds).toBe(60);

    // Should set cooldown key for 60 seconds
    expect(mockRedis.set).toHaveBeenCalledWith('verify:cooldown:guild-123:user-456', '1', 'EX', 60);
  });
});
