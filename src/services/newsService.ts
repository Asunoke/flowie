import Parser from 'rss-parser';
import cron, { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const parser = new Parser({
  headers: { 'User-Agent': 'FlowieDiscordBot/1.0 (+https://florynxlabs.com)' },
  timeout: 10000,
});

export interface NewsItem {
  title: string;
  link: string;
  snippet: string;
  pubDate?: string;
}

export class NewsService {
  private static cronTask: ScheduledTask | null = null;

  /**
   * Search headlines for a given topic or RSS URL
   */
  static async fetchHeadlines(topicOrUrl: string): Promise<NewsItem[]> {
    let feedUrl = topicOrUrl;

    // If not a direct http/https URL, query Google News RSS
    if (!topicOrUrl.startsWith('http://') && !topicOrUrl.startsWith('https://')) {
      feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topicOrUrl)}&hl=fr&gl=FR&ceid=FR:fr`;
    }

    try {
      const feed = await parser.parseURL(feedUrl);
      const items = (feed.items || []).slice(0, 5);

      return items.map((item) => {
        // Clean snippet/summary: strip HTML tags and restrict to max 2 sentences (~200 chars)
        const rawContent = item.contentSnippet || item.content || item.summary || '';
        const cleanSnippet = rawContent
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Truncate to ~180 chars for 1-2 sentence fair use summary
        const snippet = cleanSnippet.length > 180 ? cleanSnippet.slice(0, 177) + '...' : cleanSnippet;

        return {
          title: item.title || 'Sans titre',
          link: item.link || '#',
          snippet: snippet || 'Cliquez sur le lien pour consulter l\'article complet.',
          pubDate: item.pubDate,
        };
      });
    } catch (err) {
      logger.error({ err, topicOrUrl }, '[NEWS] Failed to parse RSS feed');
      throw new Error('Impossible de récupérer les actualités pour le moment.');
    }
  }

  /**
   * Fetch current Crypto price via public CoinGecko API (fallback CoinPaprika)
   */
  static async fetchCryptoPrice(symbolOrName: string) {
    const query = symbolOrName.toLowerCase().trim();

    try {
      // 1. Coingecko search / simple price
      const searchRes = await fetch(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as any;
        const coin = searchData.coins?.[0];

        if (coin?.id) {
          const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=eur,usd&include_24hr_change=true`,
            { signal: AbortSignal.timeout(5000) }
          );

          if (priceRes.ok) {
            const priceData = (await priceRes.json()) as any;
            const data = priceData[coin.id];
            if (data) {
              return {
                name: coin.name,
                symbol: coin.symbol.toUpperCase(),
                priceEur: data.eur,
                priceUsd: data.usd,
                change24h: data.eur_24h_change ?? data.usd_24h_change ?? 0,
                thumb: coin.large || coin.thumb,
              };
            }
          }
        }
      }

      // 2. Fallback CoinPaprika
      const paprikaRes = await fetch(`https://api.coinpaprika.com/v1/tickers`, {
        signal: AbortSignal.timeout(5000),
      });

      if (paprikaRes.ok) {
        const tickers = (await paprikaRes.json()) as any[];
        const coin = tickers.find(
          (t) => t.symbol.toLowerCase() === query || t.name.toLowerCase() === query
        );

        if (coin) {
          return {
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            priceEur: coin.quotes.USD?.price ? coin.quotes.USD.price * 0.92 : 0,
            priceUsd: coin.quotes.USD?.price || 0,
            change24h: coin.quotes.USD?.percent_change_24h || 0,
            thumb: undefined,
          };
        }
      }

      return null;
    } catch (err) {
      logger.error({ err, symbolOrName }, '[NEWS] Crypto API fetch error');
      return null;
    }
  }

  /**
   * Fetch current Weather via public wttr.in JSON API
   */
  static async fetchWeather(city: string) {
    try {
      const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'fr' },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const current = data.current_condition?.[0];
      const area = data.nearest_area?.[0];

      if (!current) return null;

      const cityName = area?.areaName?.[0]?.value || city;
      const country = area?.country?.[0]?.value || '';

      return {
        city: `${cityName}${country ? `, ${country}` : ''}`,
        tempC: current.temp_C,
        feelsLikeC: current.FeelsLikeC,
        humidity: current.humidity,
        windKm: current.windspeedKmph,
        condition: current.lang_fr?.[0]?.value || current.weatherDesc?.[0]?.value || 'Ensoleillé',
      };
    } catch (err) {
      logger.error({ err, city }, '[NEWS] Weather API fetch error');
      return null;
    }
  }

  /**
   * Start periodic background RSS feed processing job (runs every 15 minutes)
   */
  static startScheduler(client: Client) {
    if (this.cronTask) return;

    logger.info('[NEWS] Starting News Subscription Cron Job (every 15 minutes)...');

    this.cronTask = cron.schedule('*/15 * * * *', async () => {
      logger.info('[NEWS] Running periodic RSS feed update check...');
      try {
        const subs = await prisma.newsSubscription.findMany();

        for (const sub of subs) {
          try {
            const headlines = await this.fetchHeadlines(sub.feedUrl);
            if (headlines.length === 0) continue;

            const latest = headlines[0];
            const itemId = latest.link || latest.title;

            // Check if already posted
            if (sub.lastPostedItemId === itemId) continue;

            const channel = client.channels.cache.get(sub.channelId);
            if (channel && channel.isTextBased() && 'send' in channel) {
              const embed = EmbedService.create(
                `📰 Actualité : ${latest.title}`,
                `> ${latest.snippet}\n\n🔗 [Lire l'article sur la source](${latest.link})`,
                config.bot.colors.primary
              );

              await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);

              // Update DB lastPostedItemId
              await prisma.newsSubscription.update({
                where: { id: sub.id },
                data: { lastPostedItemId: itemId },
              });
            }
          } catch (err) {
            logger.warn({ err, subId: sub.id }, '[NEWS] Failed to process news subscription item');
          }
        }
      } catch (err) {
        logger.error({ err }, '[NEWS] Error in news scheduler cycle');
      }
    });
  }
}
