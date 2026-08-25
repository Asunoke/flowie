import pino from 'pino';
import { config } from '../config/index.js';

// Ensure UTF-8 output on Windows terminal processes if available
if (process.platform === 'win32') {
  process.env.LANG = process.env.LANG || 'en_US.UTF-8';
}

export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
            singleLine: true,
          },
        }
      : undefined,
});
