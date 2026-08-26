import Parser from 'rss-parser';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowieBot/1.0',
  },
  timeout: 10000,
});

export interface YouTubeVideo {
  id: string; // Video ID (e.g., "dQw4w9WgXcQ")
  channelId: string;
  channelTitle: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  publishedAt?: string;
}

export interface YouTubeChannel {
  channelId: string;
  title: string;
  handle: string;
}

export class YouTubeService {
  /**
   * Resolves a YouTube target input (ID, @handle, channel link) into a valid channelId and title
   */
  static async resolveChannel(target: string): Promise<YouTubeChannel | null> {
    const cleanTarget = target.trim();

    // 1. Direct Channel ID check (UC... 24 characters)
    if (/^UC[\w-]{22}$/.test(cleanTarget)) {
      const latest = await this.getLatestVideo(cleanTarget);
      return {
        channelId: cleanTarget,
        title: latest?.channelTitle || cleanTarget,
        handle: cleanTarget,
      };
    }

    const cleanHandle = cleanTarget.startsWith('@') ? cleanTarget : `@${cleanTarget}`;

    // 2. Try YouTube Data API v3 if API key is configured
    if (config.stream.youtubeApiKey) {
      try {
        const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(
          cleanTarget
        )}&key=${config.stream.youtubeApiKey}`;

        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = (await res.json()) as { items?: any[] };
          const channelItem = data.items?.[0];
          if (channelItem?.id?.channelId) {
            return {
              channelId: channelItem.id.channelId,
              title: channelItem.snippet?.title || cleanTarget,
              handle: cleanHandle,
            };
          }
        }
      } catch (err) {
        logger.debug({ err, target }, '[YOUTUBE] API v3 search error');
      }
    }

    // 3. Fallback: Scrape YouTube channel page for channelId (externalId / rssUrl)
    try {
      const scrapeUrl = `https://www.youtube.com/${encodeURIComponent(cleanHandle)}`;
      const pageRes = await fetch(scrapeUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (pageRes.ok) {
        const html = await pageRes.text();

        // Extract channel ID pattern UC... from HTML meta tags or JSON state
        const match =
          html.match(/href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/i) ||
          html.match(/channel_id=(UC[\w-]{22})/i) ||
          html.match(/"externalId":"(UC[\w-]{22})"/i) ||
          html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})">/i);

        if (match && match[1]) {
          const channelId = match[1];

          // Extract title if available
          const titleMatch =
            html.match(/<meta property="og:title" content="([^"]+)">/i) ||
            html.match(/<title>([^<]+)<\/title>/i);

          const title = titleMatch?.[1]?.replace(' - YouTube', '').trim() || cleanHandle;

          return {
            channelId,
            title,
            handle: cleanHandle,
          };
        }
      }
    } catch (err) {
      logger.debug({ err, target }, '[YOUTUBE] Page scrape fallback failed');
    }

    return null;
  }

  /**
   * Fetches the latest published video or live stream for a given YouTube channel ID via public RSS feed
   */
  static async getLatestVideo(channelId: string): Promise<YouTubeVideo | null> {
    try {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const feed = await parser.parseURL(feedUrl);

      if (!feed.items || feed.items.length === 0) {
        return null;
      }

      const latestItem = feed.items[0];

      // Extract raw video ID (from "yt:video:VIDEO_ID" or URL "v=VIDEO_ID")
      let videoId = '';
      if (latestItem.id) {
        const idParts = latestItem.id.split(':');
        videoId = idParts[idParts.length - 1];
      }
      if (!videoId && latestItem.link) {
        const match = latestItem.link.match(/v=([\w-]{11})/);
        if (match) videoId = match[1];
      }

      if (!videoId) return null;

      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const channelTitle = feed.title || latestItem.author || 'Chaîne YouTube';

      return {
        id: videoId,
        channelId,
        channelTitle,
        title: latestItem.title || 'Nouvelle vidéo YouTube',
        url: videoUrl,
        thumbnailUrl,
        publishedAt: latestItem.pubDate || latestItem.isoDate,
      };
    } catch (err) {
      logger.error({ err, channelId }, '[YOUTUBE] Error parsing channel RSS feed');
      return null;
    }
  }
}
