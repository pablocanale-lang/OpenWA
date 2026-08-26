export function kamproBaseUrl(): string {
  if (import.meta.env.DEV) return '/kampro-api';
  return (import.meta.env.VITE_KAMPRO_API_URL as string | undefined) || 'http://127.0.0.1:3100';
}

const KEY_STORAGE = 'kampro_api_key';

export function getKamproApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setKamproApiKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key);
}

export async function kamproFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type') && opts.body) headers.set('Content-Type', 'application/json');
  const key = getKamproApiKey();
  if (key) headers.set('X-API-Key', key);

  const res = await fetch(`${kamproBaseUrl()}${path}`, { ...opts, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export async function bootstrapKamproKey(): Promise<boolean> {
  try {
    const cfg = await fetch(`${kamproBaseUrl()}/ui/config`).then(r => r.json());
    if (cfg?.apiKey && !getKamproApiKey()) setKamproApiKey(cfg.apiKey);
    await kamproFetch('/health');
    return true;
  } catch {
    return false;
  }
}

export type KamproProduct = {
  id: string;
  sku: string;
  name: string;
  capacityMl: number;
  unitPricePyg: number | null;
  unitCostPyg: number | null;
  stockQty: number;
  status: string;
};

export type KamproSupplier = {
  id: string;
  name: string;
  contact: string | null;
  country: string;
  alibabaUrl: string | null;
  products?: Array<{ product?: { sku: string } }>;
};

export type KamproForwarder = { id: string; name: string; contact: string | null; country: string | null };

export type KamproPurchase = {
  id: string;
  purchasedAt: string;
  quantity: number;
  unitPrice: string;
  total: string;
  currency: string;
  fxRateToPyg: string | null;
  shipmentId: string | null;
  product?: { sku: string; name: string };
  supplier?: { name: string };
  shipment?: { reference: string };
};

export type KamproShipment = {
  id: string;
  reference: string;
  status: string;
  departedAt: string | null;
  etaAt: string | null;
  arrivedAt: string | null;
  forwarder?: { name: string };
  purchases?: Array<{ product?: { sku: string } }>;
};

export type KamproCost = {
  id: string;
  type: string;
  amount: string;
  currency: string;
  fxRateToPyg: string | null;
  description: string | null;
  shipment?: { reference: string };
  purchase?: { product?: { sku: string } };
};

export type KamproReception = {
  id: string;
  receivedAt: string;
  receivedQty: number;
  purchase?: { product?: { sku: string } };
  shipment?: { reference: string };
  incidents?: Array<{ type: string; quantity: number }>;
};

export type KamproSkuReport = {
  product: KamproProduct;
  qtyPurchased: number;
  qtyReceived: number;
  stockQty: number;
  totalsByCurrency: Record<string, { purchase: number; import: number }>;
  pygEquivalent: { purchase: number; import: number; landed: number; unitLanded: number | null } | null;
  note: string | null;
  history: Array<{
    qtyReceived: number;
    landedPyg: number | null;
    forwarderName: string | null;
    purchase: {
      purchasedAt: string;
      supplierName: string;
      shipmentReference: string | null;
      quantity: number;
      total: string;
      currency: string;
    };
    importAllocated: Array<{ allocatedAmount: string; currency: string; shared: boolean }>;
  }>;
};

export type OrderZone = 'ASUNCION' | 'INTERIOR';
export type OrderStatus =
  | 'CONFIRMADO'
  | 'PENDIENTE_DE_PAGO'
  | 'PAGO_CONFIRMADO'
  | 'LISTO_PARA_DESPACHO'
  | 'ENVIADO'
  | 'ENTREGADO'
  | 'CERRADO'
  | 'CANCELADO';
export type OrderAction = 'confirmPayment' | 'markReady' | 'markShipped' | 'markDelivered' | 'close' | 'cancel';
export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA';

export type KamproPayment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  status: string;
  reference: string | null;
};

export type KamproOrderLine = {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPricePyg: number;
  discountApplied: number;
  lineTotal: number;
  sortOrder: number;
};

export type KamproOrder = {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  discountApplied: number;
  totalAmount: number;
  zone: OrderZone;
  customerPhone: string;
  contactName: string | null;
  recipientName: string;
  invoiceName: string;
  ruc: string;
  status: OrderStatus;
  sessionId: string | null;
  chatId: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationText: string | null;
  preferredTime: string | null;
  paymentMethodPreferred: PaymentMethod | null;
  city: string | null;
  carrier: string | null;
  createdAt: string;
  updatedAt: string;
  items: KamproOrderLine[];
  payments: KamproPayment[];
  primaryAction: OrderAction | null;
  canCancel: boolean;
  salesNotify?: { ok: true; groupId: string } | { ok: false; error: string };
};

export type CreateOrderLinePayload = {
  sku: string;
  quantity: number;
  discountApplied: number;
  unitPricePyg: number;
};

export type CreateOrderPayload = {
  items: CreateOrderLinePayload[];
  zone: OrderZone;
  customerPhone: string;
  contactName?: string;
  recipientName: string;
  invoiceName: string;
  ruc: string;
  sessionId?: string;
  chatId?: string;
  locationLat?: number;
  locationLng?: number;
  locationText?: string;
  preferredTime?: string;
  paymentMethodPreferred?: PaymentMethod;
  city?: string;
  carrier?: string;
};

export type UpdateOrderPayload = {
  items?: CreateOrderLinePayload[];
  contactName?: string | null;
  recipientName?: string;
  invoiceName?: string;
  ruc?: string;
  locationLat?: number | null;
  locationLng?: number | null;
  locationText?: string | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: PaymentMethod | null;
  city?: string | null;
  carrier?: string | null;
};

export function actionNeedsPayment(order: KamproOrder, action: OrderAction): boolean {
  return action === 'confirmPayment' || (action === 'markDelivered' && order.zone === 'ASUNCION');
}

export function isOpenOrder(status: OrderStatus): boolean {
  return status !== 'CERRADO' && status !== 'CANCELADO';
}
