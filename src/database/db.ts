import { createRequire } from 'module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' },
  ],
});

export async function connectDB() {
  try {
    await prisma.$connect();
    logger.info('[DB] Connected to PostgreSQL database via Prisma');
  } catch (error) {
    logger.error({ err: error }, '[DB] Failed to connect to database');
  }
}
