import Fastify from 'fastify';
import { registerApiKeyHook } from './auth.js';
import { apiRoutes } from './routes.js';
import { uiRoutes } from './ui.js';
import { ensureInvoiceSequence } from '../services/invoice.service.js';
import { ensureSystemAccounts } from '../services/accounts.service.js';
import { migrateOpenOrderReservations } from '../services/stock.service.js';
import { ensureLotsMatchOnHand } from '../services/fifo.service.js';
import { refreshOrderJournalMemos } from '../services/accounting.service.js';

export async function buildApiServer() {
  const app = Fastify({ logger: true });
  registerApiKeyHook(app);
  await app.register(uiRoutes);
  await app.register(apiRoutes);
  return app;
}

export async function startApiServer() {
  await ensureInvoiceSequence();
  await ensureSystemAccounts();
  await migrateOpenOrderReservations();
  await ensureLotsMatchOnHand();
  await refreshOrderJournalMemos();
  const app = await buildApiServer();
  const host = process.env.KAMPRO_API_HOST ?? '127.0.0.1';
  const port = Number(process.env.KAMPRO_API_PORT ?? 3100);
  await app.listen({ host, port });
  return app;
}
