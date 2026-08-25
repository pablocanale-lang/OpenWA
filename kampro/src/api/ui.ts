import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../public');

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/ui': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/ui/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/ui/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/ui/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

export async function uiRoutes(app: FastifyInstance) {
  for (const [path, meta] of Object.entries(FILES)) {
    app.get(path, async (_req, reply) => {
      const body = await readFile(join(publicDir, meta.file));
      return reply.type(meta.type).send(body);
    });
  }

  app.get('/ui/config', async () => ({
    apiKey:
      process.env.KAMPRO_EXPOSE_UI_KEY === 'false' ? null : (process.env.KAMPRO_API_KEY ?? null),
    port: Number(process.env.KAMPRO_API_PORT ?? 3100),
    openwaUrl: process.env.OPENWA_BASE_URL ?? 'http://127.0.0.1:2785',
  }));
}

export function isUiPath(urlPath: string): boolean {
  if (urlPath === '/' || urlPath === '/ui' || urlPath === '/ui/') return true;
  if (urlPath.startsWith('/ui/')) return true;
  return false;
}
