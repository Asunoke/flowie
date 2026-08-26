import http from 'http';
import { Client } from 'discord.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export function startHealthServer(client: Client, shardId: number = 0) {
  const port = config.scaling.healthPort + shardId;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (url.pathname === '/health' || url.pathname === '/') {
      const mem = process.memoryUsage();
      const payload = {
        shardId,
        status: client.ws.ping >= 0 ? 'ok' : 'connecting',
        latencyMs: client.ws.ping,
        guildsCount: client.guilds.cache.size,
        usersCount: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
        uptimeSec: Math.floor(process.uptime()),
        memoryUsageMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
        timestamp: new Date().toISOString(),
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    } else if (url.pathname.startsWith('/guilds/')) {
      const guildId = url.pathname.split('/')[2];
      const hasGuild = guildId ? client.guilds.cache.has(guildId) : false;
      if (hasGuild) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ active: true, guildId }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ active: false, guildId }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`[HEALTH] Port ${port} is already in use. Health server skipped or running elsewhere.`);
    } else {
      logger.error(`[HEALTH] Health server error:`, err);
    }
  });

  server.listen(port, () => {
    logger.info(`[HEALTH] Health check server for Shard #${shardId} running on http://localhost:${port}/health`);
  });

  return server;
}
