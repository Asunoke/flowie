import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../src/database/db.js', () => ({
  prisma: {
    embedTemplate: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
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

import { EmbedBuilderService } from '../src/services/embedBuilderService.js';
import { prisma } from '../src/database/db.js';

describe('EmbedBuilderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildEmbed', () => {
    it('should construct an EmbedBuilder with title, description, fields and color', () => {
      const data = {
        title: 'Titre de Test',
        description: 'Description de test',
        color: '#D4AF37',
        imageUrl: 'https://example.com/image.png',
        footerText: 'Footer personnalisé',
        fields: [{ name: 'Champ 1', value: 'Valeur 1', inline: true }],
      };

      const embed = EmbedBuilderService.buildEmbed(data);
      const json = embed.toJSON();

      expect(json.title).toBe('Titre de Test');
      expect(json.description).toBe('Description de test');
      expect(json.color).toBe(0xD4AF37);
      expect(json.image?.url).toBe('https://example.com/image.png');
      expect(json.footer?.text).toContain('Footer personnalisé');
      expect(json.fields).toHaveLength(1);
    });
  });

  describe('saveTemplate & getTemplate', () => {
    it('should upsert embed template in DB', async () => {
      vi.mocked(prisma.embedTemplate.upsert).mockResolvedValue({} as never);

      const embedData = { title: 'Règlement', description: 'Respectez les règles' };
      await EmbedBuilderService.saveTemplate('guild-1', 'reglement', embedData, 'user-1');

      expect(prisma.embedTemplate.upsert).toHaveBeenCalledWith({
        where: { guildId_name: { guildId: 'guild-1', name: 'reglement' } },
        create: {
          guildId: 'guild-1',
          name: 'reglement',
          embedData,
          createdBy: 'user-1',
        },
        update: {
          embedData,
          createdBy: 'user-1',
        },
      });
    });

    it('should retrieve a saved template by name', async () => {
      const mockTemplate = { id: 't-1', name: 'annonce', embedData: { title: 'Annonce' } };
      vi.mocked(prisma.embedTemplate.findUnique).mockResolvedValue(mockTemplate as never);

      const res = await EmbedBuilderService.getTemplate('guild-1', 'annonce');
      expect(res).toEqual(mockTemplate);
    });
  });

  describe('editBotEmbed', () => {
    it('should throw an error if the message was not sent by the bot', async () => {
      const mockMessage = {
        author: { id: 'other-user-id' },
      };
      const mockChannel = {
        client: { user: { id: 'bot-id' } },
        messages: {
          fetch: vi.fn().mockResolvedValue(mockMessage),
        },
      };

      await expect(
        EmbedBuilderService.editBotEmbed(mockChannel as never, 'msg-123', { title: 'Nouveau' })
      ).rejects.toThrow(/Vous ne pouvez modifier que les messages/i);

    });

    it('should edit the message if sent by the bot', async () => {
      const mockMessage = {
        author: { id: 'bot-id' },
        edit: vi.fn().mockResolvedValue({}),
      };
      const mockChannel = {
        client: { user: { id: 'bot-id' } },
        messages: {
          fetch: vi.fn().mockResolvedValue(mockMessage),
        },
      };

      await EmbedBuilderService.editBotEmbed(mockChannel as never, 'msg-123', { title: 'Nouveau Titre' });

      expect(mockMessage.edit).toHaveBeenCalled();
    });
  });
});
