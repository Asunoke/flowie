import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma & Logger ──────────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    guild: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    moderationCase: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    member: {
      upsert: vi.fn(),
    },
    warning: {
      create: vi.fn(),
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

import { ModerationService } from '../src/services/moderationService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Role Hierarchy Tests ──────────────────────────────────────────────────

describe('ModerationService.checkRoleHierarchy', () => {
  it('should reject self moderation', () => {
    const mod = { id: 'user-1', roles: { highest: { position: 10 } }, guild: { ownerId: 'owner-id' } } as any;
    const target = { id: 'user-1', roles: { highest: { position: 10 } }, guild: { ownerId: 'owner-id' } } as any;

    const result = ModerationService.checkRoleHierarchy(mod, target);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('vous-même');
  });

  it('should allow guild owner to moderate anyone', () => {
    const mod = { id: 'owner-id', roles: { highest: { position: 5 } }, guild: { ownerId: 'owner-id' } } as any;
    const target = { id: 'user-2', roles: { highest: { position: 20 } }, guild: { ownerId: 'owner-id' } } as any;

    const result = ModerationService.checkRoleHierarchy(mod, target);
    expect(result.allowed).toBe(true);
  });

  it('should reject moderation when target has higher or equal role position', () => {
    const mod = { id: 'mod-1', user: { tag: 'Mod#0001' }, roles: { highest: { position: 10, name: 'Mod' } }, guild: { ownerId: 'owner-id' } } as any;
    const target = { id: 'admin-1', user: { tag: 'Admin#0001' }, roles: { highest: { position: 15, name: 'Admin' } }, guild: { ownerId: 'owner-id' } } as any;

    const result = ModerationService.checkRoleHierarchy(mod, target);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('supérieur ou égal');
  });

  it('should allow moderation when target has lower role position', () => {
    const mod = { id: 'mod-1', user: { tag: 'Mod#0001' }, roles: { highest: { position: 10, name: 'Mod' } }, guild: { ownerId: 'owner-id' } } as any;
    const target = { id: 'user-2', user: { tag: 'User#0001' }, roles: { highest: { position: 5, name: 'Member' } }, guild: { ownerId: 'owner-id' } } as any;

    const result = ModerationService.checkRoleHierarchy(mod, target);
    expect(result.allowed).toBe(true);
  });
});

// ─── Moderation Case DB Tests ──────────────────────────────────────────────

describe('ModerationService.createCase', () => {
  it('should create a moderation case entry in DB', async () => {
    mockPrisma.moderationCase.create.mockResolvedValue({
      id: 'case-12345678',
      guildId: 'guild-1',
      targetId: 'user-2',
      moderatorId: 'mod-1',
      type: 'SOFTBAN',
      reason: 'Spam récurrent',
      createdAt: new Date(),
    });

    const modCase = await ModerationService.createCase(
      'guild-1',
      'user-2',
      'mod-1',
      'SOFTBAN',
      'Spam récurrent'
    );

    expect(modCase).not.toBeNull();
    expect(modCase?.type).toBe('SOFTBAN');
    expect(mockPrisma.moderationCase.create).toHaveBeenCalledWith({
      data: {
        guildId: 'guild-1',
        targetId: 'user-2',
        moderatorId: 'mod-1',
        type: 'SOFTBAN',
        reason: 'Spam récurrent',
      },
    });
  });
});
