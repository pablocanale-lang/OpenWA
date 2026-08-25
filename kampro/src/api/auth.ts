import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { HttpError } from '../http-error.js';
import { isUiPath } from './ui.js';

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url.split('?')[0] ?? '';
  if (request.method === 'OPTIONS') return;
  if (url === '/health' || isUiPath(url)) return;

  const expected = process.env.KAMPRO_API_KEY;
  if (!expected) return;
  const key = request.headers['x-api-key'];
  if (key !== expected) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export function registerApiKeyHook(app: import('fastify').FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
    return apiKeyAuth(request, reply);
  });
}

export function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'Validación', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  const message = err instanceof Error ? err.message : 'Error interno';
  return reply.code(500).send({ error: message });
}
