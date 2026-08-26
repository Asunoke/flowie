import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  // Fallback for dev/tests if missing
}

import fs from 'fs';
import path from 'path';

let jsonConfig = {
  embed: {
    footerText: 'Flowie • Florynx Labs',
    footerIconUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
  },
  economy: {
    defaultCurrency: 'Flow',
  },
  owners: {
    primaryOwnerId: process.env.OWNER_ID || '',
    subOwnerIds: [] as string[],
  },
};

try {
  const jsonPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const parsedJson = JSON.parse(raw);
    jsonConfig = { ...jsonConfig, ...parsedJson };
  }
} catch {
  // Use defaults
}

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID,
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  bot: {
    name: 'Flowie',
    signature: 'Flowie by Florynx Labs',
    slogan: 'Born from love. Bound by physics.',
    colors: {
      primary: 0x0B3D2E, // Forest Green #0B3D2E
      gold: 0xD4AF37,    // Gold #D4AF37
      success: 0x2ECC71, // Emerald Green
      warning: 0xF39C12, // Orange
      error: 0xE74C3C,   // Red
      info: 0x3498DB,    // Blue
    },
    footer: {
      text: jsonConfig.embed?.footerText || 'Flowie • Florynx Labs',
      iconUrl: jsonConfig.embed?.footerIconUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
  },
  economy: {
    defaultCurrency: jsonConfig.economy?.defaultCurrency || 'Flow',
  },
  owner: {
    prefix: process.env.OWNER_PREFIX || '!!',
    id: process.env.OWNER_ID || jsonConfig.owners?.primaryOwnerId || '',
    subOwnerIds: jsonConfig.owners?.subOwnerIds || [],
    logChannelId: process.env.OWNER_LOG_CHANNEL_ID || '',
  },
  scaling: {
    shardCount: process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT, 10) : 'auto',
    dbConnectionLimit: process.env.DATABASE_CONNECTION_LIMIT || '20',
    healthPort: process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : 4000,
    configCacheTtl: process.env.CONFIG_CACHE_TTL ? parseInt(process.env.CONFIG_CACHE_TTL, 10) : 600,
    lockedMode: (process.env.LOCKED_MODE as 'leave' | 'stay_disabled') || 'leave',
    officialDiscordInvite: process.env.OFFICIAL_DISCORD_INVITE || 'https://discord.gg/florynxlabs',
  },
  lavalink: {
    host: process.env.LAVALINK_HOST || 'localhost',
    port: process.env.LAVALINK_PORT ? parseInt(process.env.LAVALINK_PORT, 10) : 2333,
    // Password is kept opaque — never log config.lavalink.password
    password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: process.env.LAVALINK_SECURE === 'true',
  },
  music: {
    queueLimit: process.env.MUSIC_QUEUE_LIMIT ? parseInt(process.env.MUSIC_QUEUE_LIMIT, 10) : 200,
    idleTimeoutSec: process.env.MUSIC_IDLE_TIMEOUT ? parseInt(process.env.MUSIC_IDLE_TIMEOUT, 10) : 300,
  },
  stream: {
    twitchClientId: process.env.TWITCH_CLIENT_ID || '',
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || '',
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    maxSubsPerGuild: process.env.MAX_STREAM_SUBS_PER_GUILD
      ? parseInt(process.env.MAX_STREAM_SUBS_PER_GUILD, 10)
      : 10,
  },
};


