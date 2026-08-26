import { logger } from '../utils/logger.js';

const LIBRETRANSLATE_URL = 'https://libretranslate.com/translate';

export interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
}

export class TranslateService {
  /**
   * Translates text to French via LibreTranslate API (free, no key needed for most instances).
   * Detects source language automatically.
   */
  static async toFrench(text: string): Promise<TranslationResult> {
    const truncated = text.slice(0, 1500);

    const response = await fetch(LIBRETRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: truncated,
        source: 'auto',
        target: 'fr',
        format: 'text',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error({ status: response.status, body: errText }, '[TranslateService] API error');
      throw new Error(`Impossible de contacter le service de traduction (HTTP ${response.status}).`);
    }


    const data = await response.json() as {
      translatedText?: string;
      detectedLanguage?: { language: string; confidence: number };
      error?: string;
    };

    if (data.error) {
      throw new Error(`Erreur de traduction : ${data.error}`);
    }

    if (!data.translatedText) {
      throw new Error('Le service de traduction a retourné une réponse vide.');
    }

    return {
      translatedText: data.translatedText,
      detectedLanguage: data.detectedLanguage?.language ?? 'unknown',
    };
  }
}
