import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface TwitchStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameName: string;
  title: string;
  viewerCount: number;
  startedAt: string;
  thumbnailUrl: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
}

export class TwitchService {
  private static accessToken: string | null = null;
  private static tokenExpiresAt: number = 0;

  /**
   * Check if Twitch API integration is configured
   */
  static isConfigured(): boolean {
    return Boolean(config.stream.twitchClientId && config.stream.twitchClientSecret);
  }

  /**
   * Retrieves a valid App Access Token via Twitch OAuth Client Credentials Flow
   */
  static async getAccessToken(): Promise<string | null> {
    if (!this.isConfigured()) {
      logger.debug('[TWITCH] Client ID or Secret missing in configuration.');
      return null;
    }

    // Return cached token if valid for at least 1 more minute
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      const url = 'https://id.twitch.tv/oauth2/token';
      const params = new URLSearchParams({
        client_id: config.stream.twitchClientId,
        client_secret: config.stream.twitchClientSecret,
        grant_type: 'client_credentials',
      });

      const response = await fetch(url, {
        method: 'POST',
        body: params,
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        logger.error(`[TWITCH] OAuth Token fetch failed with status ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

      logger.info('[TWITCH] Successfully acquired new App Access Token.');
      return this.accessToken;
    } catch (err) {
      logger.error({ err }, '[TWITCH] Error acquiring OAuth access token');
      return null;
    }
  }

  /**
   * Validates if a Twitch user exists and resolves their details
   */
  static async validateUser(username: string): Promise<TwitchUser | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');

    try {
      const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanUsername)}`;
      const response = await fetch(url, {
        headers: {
          'Client-ID': config.stream.twitchClientId,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { data: any[] };
      const user = data.data?.[0];

      if (!user) return null;

      return {
        id: user.id,
        login: user.login,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url,
      };
    } catch (err) {
      logger.error({ err, username }, '[TWITCH] Error fetching user profile');
      return null;
    }
  }

  /**
   * Fetches active live streams for a list of streamer logins in batch
   */
  static async getStreams(userLogins: string[]): Promise<TwitchStream[]> {
    if (userLogins.length === 0) return [];

    const token = await this.getAccessToken();
    if (!token) return [];

    // Deduplicate and clean logins
    const uniqueLogins = Array.from(new Set(userLogins.map((l) => l.trim().toLowerCase())));
    const results: TwitchStream[] = [];

    // Twitch API permits up to 100 user_login params per request
    const chunkSize = 100;
    for (let i = 0; i < uniqueLogins.length; i += chunkSize) {
      const chunk = uniqueLogins.slice(i, i + chunkSize);
      const queryParams = chunk.map((login) => `user_login=${encodeURIComponent(login)}`).join('&');
      const url = `https://api.twitch.tv/helix/streams?${queryParams}`;

      try {
        let response = await fetch(url, {
          headers: {
            'Client-ID': config.stream.twitchClientId,
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(10000),
        });

        // Retry once if token expired (HTTP 401)
        if (response.status === 401) {
          this.accessToken = null;
          const freshToken = await this.getAccessToken();
          if (!freshToken) continue;

          response = await fetch(url, {
            headers: {
              'Client-ID': config.stream.twitchClientId,
              Authorization: `Bearer ${freshToken}`,
            },
            signal: AbortSignal.timeout(10000),
          });
        }

        if (!response.ok) {
          logger.warn(`[TWITCH] Streams API returned status ${response.status}`);
          continue;
        }

        const data = (await response.json()) as { data: any[] };
        const streams = data.data || [];

        for (const item of streams) {
          // Format thumbnail URL to standard 1280x720
          const formattedThumb = (item.thumbnail_url || '')
            .replace('{width}', '1280')
            .replace('{height}', '720');

          results.push({
            id: item.id,
            userId: item.user_id,
            userLogin: item.user_login,
            userName: item.user_name,
            gameName: item.game_name || 'En direct sur Twitch',
            title: item.title || 'Sans titre',
            viewerCount: item.viewer_count || 0,
            startedAt: item.started_at,
            thumbnailUrl: formattedThumb,
          });
        }
      } catch (err) {
        logger.error({ err }, '[TWITCH] Error querying Twitch Helix streams batch API');
      }
    }

    return results;
  }
}
