import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Logger ──────────────────────────────────────────────────────────────
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { TranslateService } from '../src/services/translateService.js';

describe('TranslateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('toFrench', () => {
    it('should return translated text and detected language on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          translatedText: 'Bonjour le monde',
          detectedLanguage: { language: 'en', confidence: 0.98 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await TranslateService.toFrench('Hello world');

      expect(result.translatedText).toBe('Bonjour le monde');
      expect(result.detectedLanguage).toBe('en');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://libretranslate.com/translate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Hello world'),
        })
      );
    });

    it('should throw an error when API returns HTTP error status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Too many requests',
      }));

      await expect(TranslateService.toFrench('Hello')).rejects.toThrow(/HTTP 429/);
    });

    it('should throw when API returns an error field in JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'Language pair not supported',
        }),
      }));

      await expect(TranslateService.toFrench('Hola')).rejects.toThrow(/Language pair not supported/);
    });

    it('should throw when API returns empty translatedText', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          translatedText: '',
          detectedLanguage: { language: 'es', confidence: 0.5 },
        }),
      }));

      await expect(TranslateService.toFrench('Hola')).rejects.toThrow(/réponse vide/);
    });

    it('should truncate input text to 1500 characters before sending', async () => {
      const longText = 'A'.repeat(2000);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          translatedText: 'A'.repeat(100),
          detectedLanguage: { language: 'en', confidence: 0.99 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await TranslateService.toFrench(longText);

      const bodyStr: string = mockFetch.mock.calls[0][1].body;
      const body = JSON.parse(bodyStr);
      expect(body.q.length).toBe(1500);
    });
  });
});
