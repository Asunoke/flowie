import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB, Logger & Fetch ───────────────────────────────────────────────

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    newsSubscription: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/database/db.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('rss-parser', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      parseURL: vi.fn().mockResolvedValue({
        items: [
          {
            title: 'Test Headline Title',
            link: 'https://example.com/news/1',
            contentSnippet: 'This is a test summary for the news article snippet.',
            pubDate: 'Tue, 25 Aug 2026 20:00:00 GMT',
          },
        ],
      }),
    })),
  };
});

import { NewsService } from '../src/services/newsService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewsService', () => {
  it('should fetch and format RSS headlines correctly', async () => {
    const headlines = await NewsService.fetchHeadlines('tech');
    expect(headlines).toHaveLength(1);
    expect(headlines[0].title).toBe('Test Headline Title');
    expect(headlines[0].link).toBe('https://example.com/news/1');
    expect(headlines[0].snippet).toContain('This is a test summary');
  });

  it('should fetch crypto price from API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('search')) {
        return new Response(JSON.stringify({ coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' }] }));
      }
      if (urlStr.includes('simple/price')) {
        return new Response(JSON.stringify({ bitcoin: { eur: 60000, usd: 65000, eur_24h_change: 2.5 } }));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const crypto = await NewsService.fetchCryptoPrice('BTC');
    expect(crypto).not.toBeNull();
    expect(crypto?.name).toBe('Bitcoin');
    expect(crypto?.priceEur).toBe(60000);
    expect(crypto?.change24h).toBe(2.5);

    fetchSpy.mockRestore();
  });

  it('should fetch weather data from wttr.in API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          current_condition: [
            { temp_C: '22', FeelsLikeC: '23', humidity: '55', windspeedKmph: '12', lang_fr: [{ value: 'Ensoleillé' }] },
          ],
          nearest_area: [{ areaName: [{ value: 'Paris' }], country: [{ value: 'France' }] }],
        })
      );
    });

    const weather = await NewsService.fetchWeather('Paris');
    expect(weather).not.toBeNull();
    expect(weather?.city).toBe('Paris, France');
    expect(weather?.tempC).toBe('22');
    expect(weather?.condition).toBe('Ensoleillé');

    fetchSpy.mockRestore();
  });
});
