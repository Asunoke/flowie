import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    applicationForm: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    application: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
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

import { ApplyService } from '../src/services/applyService.js';
import { prisma } from '../src/database/db.js';

describe('ApplyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createForm & getForm', () => {
    it('should upsert application form in DB', async () => {
      vi.mocked(prisma.applicationForm.upsert).mockResolvedValue({} as never);

      const questions = [{ id: 'q_1', label: 'Présentation', style: 'paragraph' as const, required: true }];
      await ApplyService.createForm('guild-1', 'Modérateur', 'chan-review', questions);

      expect(prisma.applicationForm.upsert).toHaveBeenCalledWith({
        where: { guildId_position: { guildId: 'guild-1', position: 'Modérateur' } },
        create: {
          guildId: 'guild-1',
          position: 'Modérateur',
          reviewChannelId: 'chan-review',
          questions,
        },
        update: {
          reviewChannelId: 'chan-review',
          questions,
        },
      });
    });

    it('should retrieve application form from DB', async () => {
      const mockForm = { id: 'form-1', position: 'Modérateur' };
      vi.mocked(prisma.applicationForm.findUnique).mockResolvedValue(mockForm as never);

      const result = await ApplyService.getForm('guild-1', 'Modérateur');

      expect(result).toEqual(mockForm);
    });
  });

  describe('submitApplication', () => {
    it('should create application record and send review embed to staff channel', async () => {
      vi.mocked(prisma.application.create).mockResolvedValue({ id: 'app-123' } as never);
      vi.mocked(prisma.application.update).mockResolvedValue({} as never);

      const mockReviewChannel = {
        send: vi.fn().mockResolvedValue({ id: 'msg-staff-1' }),
      };

      const answers = { 'Présentation': 'Bonjour je suis John' };
      const app = await ApplyService.submitApplication(
        'guild-1',
        'Modérateur',
        'candidate-1',
        answers,
        mockReviewChannel as never
      );

      expect(prisma.application.create).toHaveBeenCalledWith({
        data: {
          guildId: 'guild-1',
          position: 'Modérateur',
          applicantId: 'candidate-1',
          answers,
          status: 'pending',
        },
      });
      expect(mockReviewChannel.send).toHaveBeenCalled();
      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-123' },
        data: { messageId: 'msg-staff-1' },
      });
      expect(app.id).toBe('app-123');
    });
  });

  describe('reviewApplication', () => {
    it('should update application status, edit review message, and send DM to applicant', async () => {
      const mockApp = {
        id: 'app-123',
        guildId: 'guild-1',
        position: 'Modérateur',
        applicantId: 'candidate-1',
        answers: { 'Présentation': 'John' },
        status: 'pending',
      };

      vi.mocked(prisma.application.findUnique).mockResolvedValue(mockApp as never);
      vi.mocked(prisma.application.update).mockResolvedValue({} as never);

      const mockApplicantUser = {
        send: vi.fn().mockResolvedValue({}),
      };

      const mockClient = {
        users: {
          fetch: vi.fn().mockResolvedValue(mockApplicantUser),
        },
      };

      const mockReviewMessage = {
        embeds: [{ title: '📋 Candidature — Modérateur' }],
        edit: vi.fn().mockResolvedValue({}),
      };

      await ApplyService.reviewApplication(
        'app-123',
        'staff-1',
        'accepted',
        mockClient as never,
        mockReviewMessage as never
      );

      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-123' },
        data: { status: 'accepted', reviewedBy: 'staff-1' },
      });
      expect(mockReviewMessage.edit).toHaveBeenCalled();
      expect(mockApplicantUser.send).toHaveBeenCalled();
    });
  });
});
