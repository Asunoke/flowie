import { redis } from './redisService.js';
import { logger } from '../utils/logger.js';

export class CooldownService {
  /**
   * Check if a command or action is on cooldown for a user/guild key.
   * Returns { onCooldown: false } if allowed, or { onCooldown: true, remainingSeconds } if limited.
   */
  static async checkCooldown(
    key: string,
    cooldownSeconds: number
  ): Promise<{ onCooldown: boolean; remainingSeconds: number }> {
    try {
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        return { onCooldown: true, remainingSeconds: ttl };
      }
    } catch (err) {
      logger.warn({ err, key }, '[COOLDOWN] Cooldown check failed, bypassing check');
    }
    return { onCooldown: false, remainingSeconds: 0 };
  }

  /**
   * Set cooldown for a key for a given duration in seconds.
   */
  static async setCooldown(key: string, cooldownSeconds: number): Promise<void> {
    try {
      await redis.set(key, '1', 'EX', cooldownSeconds);
    } catch (err) {
      logger.warn({ err, key }, '[COOLDOWN] Failed to set cooldown');
    }
  }
}
