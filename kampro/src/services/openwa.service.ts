import { DEFAULT_SALES_GROUP_NAME, formatSalesNotifyMessage, type SalesNotifyOrder } from '../domain/sales-notify.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OpenWaSession = { id: string; name: string; status: string };
type OpenWaGroup = { id: string; name: string };

export type SalesNotifyResult = { ok: true; groupId: string } | { ok: false; error: string };

function openwaConfig() {
  const baseUrl = (process.env.OPENWA_BASE_URL ?? 'http://127.0.0.1:2785').replace(/\/+$/, '');
  const apiKey = process.env.OPENWA_API_KEY ?? '';
  return { baseUrl, apiKey };
}

async function openwaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = openwaConfig();
  if (!apiKey) throw new Error('Falta OPENWA_API_KEY para avisar al grupo de ventas');
  const headers = new Headers(init.headers);
  headers.set('X-API-Key', apiKey);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.message || data.error || `OpenWA ${res.status}`);
  }
  return data;
}

async function listSessions(): Promise<OpenWaSession[]> {
  return openwaFetch<OpenWaSession[]>('/api/sessions?limit=1000');
}

async function resolveSessionId(preferred?: string | null): Promise<string> {
  const configured = process.env.OPENWA_SESSION_ID?.trim() || '';
  if (preferred && UUID_RE.test(preferred)) return preferred;
  if (configured && UUID_RE.test(configured)) return configured;

  const sessions = await listSessions();
  if (configured) {
    const byName = sessions.find((s) => s.name.toLowerCase() === configured.toLowerCase());
    if (byName) return byName.id;
  }
  const ready = sessions.find((s) => s.status === 'ready') ?? sessions[0];
  if (!ready) throw new Error('No hay sesión de WhatsApp disponible para avisar al grupo');
  return ready.id;
}

async function findSalesGroupId(sessionId: string): Promise<{ id: string; name: string }> {
  const wanted = (process.env.KAMPRO_SALES_GROUP_NAME ?? DEFAULT_SALES_GROUP_NAME).trim().toLowerCase();
  const groups = await openwaFetch<OpenWaGroup[]>(
    `/api/sessions/${encodeURIComponent(sessionId)}/groups?limit=1000`,
  );
  const match = groups.find((g) => g.name.trim().toLowerCase() === wanted);
  if (!match) {
    throw new Error(`No se encontró el grupo de WhatsApp "${process.env.KAMPRO_SALES_GROUP_NAME ?? DEFAULT_SALES_GROUP_NAME}"`);
  }
  return match;
}

export async function notifySalesGroup(order: SalesNotifyOrder & { sessionId?: string | null }): Promise<SalesNotifyResult> {
  try {
    const sessionId = await resolveSessionId(order.sessionId);
    const group = await findSalesGroupId(sessionId);
    const text = formatSalesNotifyMessage(order);
    await openwaFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId: group.id, text }),
    });
    return { ok: true, groupId: group.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo avisar al grupo de ventas' };
  }
}
