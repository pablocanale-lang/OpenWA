export function kamproBaseUrl(): string {
  if (import.meta.env.DEV) return '/kampro-api';
  return (import.meta.env.VITE_KAMPRO_API_URL as string | undefined) || '/kampro-api';
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

export type KamproStockMovement = {
  id: string;
  productId: string;
  quantity: number;
  reason: 'RECEPCION' | 'AJUSTE' | 'RESERVA' | 'VENTA' | 'CANCELACION_PEDIDO' | 'CANCELACION_COMPRA' | 'DEVOLUCION';
  notes: string | null;
  createdAt: string;
  orderId?: string | null;
};

export type KamproProduct = {
  id: string;
  sku: string;
  name: string;
  capacityMl: number;
  unitPricePyg: number | null;
  unitCostPyg: number | null;
  stockQty: number;
  reservedQty?: number;
  availableQty?: number;
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

export type PurchaseOrderStatus = 'BORRADOR' | 'CONFIRMADA' | 'CERRADA' | 'CANCELADA';

export type KamproPurchaseOrderInvoice = {
  id: string;
  invoiceNumber: string;
  ruc: string;
  legalName: string;
  issuedAt: string;
  amount: string;
  purchaseOrder?: {
    id: string;
    status: PurchaseOrderStatus;
    orderedAt: string;
    supplierName: string;
    productName: string;
  };
};

export type KamproPurchaseOrderLine = {
  productId: string;
  quantity: number;
  unitPrice: string;
  product?: { id: string; sku: string; name: string };
};

export type KamproPurchaseOrder = {
  id: string;
  number?: number | null;
  numberLabel?: string | null;
  status: PurchaseOrderStatus;
  orderedAt: string;
  origin: string;
  destination: string;
  quantity: number;
  unitPrice: string;
  freight: string;
  otherCharges: string;
  fxRateToPyg: string | null;
  chinaPyg: string | null;
  spentPyg: string | null;
  comments: string | null;
  currency: string;
  paymentReceipt: string | null;
  confirmedAt: string | null;
  receivedAt: string | null;
  customsCost: string | null;
  dispatchCost: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  forwarderId: string;
  supplierId: string;
  productId: string;
  productName?: string;
  merchandiseTotal: string;
  openTotal: string;
  landedTotal: string;
  items?: KamproPurchaseOrderLine[];
  forwarder?: { id: string; name: string };
  supplier?: { id: string; name: string };
  product?: { id: string; sku: string; name: string };
  invoices: KamproPurchaseOrderInvoice[];
};

export type KamproPurchaseOrderSummary = {
  draft: number;
  open: number;
  closed: number;
  cancelled: number;
  total: number;
  quantity: number;
  spent: string;
};

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
  | 'CANCELADO'
  | 'DEVUELTO';
export type OrderAction = 'confirmPayment' | 'markReady' | 'markShipped' | 'markDelivered' | 'close' | 'cancel' | 'returnOrder';
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
  number?: number | null;
  numberLabel?: string | null;
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
  invoiceSettlement?: InvoiceSettlement;
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
  shippingCostPyg: number | null;
  invoiceNumber: string | null;
  invoiceIssuer: string | null;
  invoiceIssuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: KamproOrderLine[];
  payments: KamproPayment[];
  primaryAction: OrderAction | null;
  canCancel: boolean;
  canReturn: boolean;
  canEditDetails: boolean;
  canEditCommercial: boolean;
  canEditShipping: boolean;
  netPaid: number;
  salesNotify?: { ok: true; groupId: string } | { ok: false; error: string };
};

export type InvoiceSettlement = 'CONTADO' | 'CREDITO';
export type TreasuryAccount = 'CAJA' | 'BANCO';

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
  invoiceSettlement?: InvoiceSettlement;
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
  invoiceSettlement?: InvoiceSettlement;
  locationLat?: number | null;
  locationLng?: number | null;
  locationText?: string | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: PaymentMethod | null;
  city?: string | null;
  carrier?: string | null;
  shippingCostPyg?: number | null;
};

export function actionNeedsPayment(order: KamproOrder, action: OrderAction): boolean {
  return action === 'confirmPayment' || (action === 'markDelivered' && order.zone === 'ASUNCION');
}

export function actionNeedsShipping(action: OrderAction): boolean {
  return action === 'close';
}

export function isOpenOrder(status: OrderStatus): boolean {
  return status !== 'CERRADO' && status !== 'CANCELADO' && status !== 'DEVUELTO';
}

export type BusinessPeriod = 'day' | 'week' | 'month' | 'year';

export type BusinessReport = {
  period: BusinessPeriod;
  timezone: string;
  range: { fromKey: string; toKey: string };
  previousRange: { fromKey: string; toKey: string };
  revenuePyg: number;
  previousRevenuePyg: number;
  revenueDeltaPct: number | null;
  paidOrderCount: number;
  previousPaidOrderCount: number;
  unitsSold: number;
  previousUnitsSold: number;
  avgTicketPyg: number | null;
  byProduct: Array<{ sku: string; name: string; units: number; revenuePyg: number }>;
  byZone: {
    ASUNCION: { revenuePyg: number; payments: number };
    INTERIOR: { revenuePyg: number; payments: number };
  };
  byMethod: { EFECTIVO: number; TRANSFERENCIA: number };
  customers: { new: number; returning: number; newRevenuePyg: number; returningRevenuePyg: number };
  series: Array<{ date: string; revenuePyg: number; payments: number }>;
  pipeline: Record<string, number>;
  invoicesIssued: number;
  pendingCollection: { count: number; amountPyg: number; deliveryPyg: number; encomiendaPyg: number };
  stock: Array<{ sku: string; name: string; stockQty: number; unitPricePyg: number | null }>;
  importSpend: { pyg: number; missingFx: boolean };
  followUpChats: number;
  targets: { dayPyg: number | null; weekPyg: number | null; monthPyg: number | null; yearPyg: number | null };
  targetPyg: number | null;
  goalPct: number | null;
  goalRemainingPyg: number | null;
};

export function fetchBusinessReport(period: BusinessPeriod) {
  return kamproFetch<BusinessReport>(`/reports/business?period=${period}`);
}

export function saveSalesTargets(body: Partial<BusinessReport['targets']>) {
  return kamproFetch<BusinessReport['targets']>('/reports/targets', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export type KamproAccount = {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COST' | 'EXPENSE';
  role: string | null;
  parentId: string | null;
  postable: boolean;
  system: boolean;
  parent?: { id: string; code: string; name: string } | null;
};

export type KamproJournalLine = {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  memo: string | null;
  account: { code: string; name: string };
};

export type KamproJournalEntry = {
  id: string;
  number: number;
  numberLabel: string;
  datedAt: string;
  memo: string;
  sourceType: string;
  sourceId: string;
  event: string;
  reversesId: string | null;
  reversed: boolean;
  documentNumber: string | null;
  lines: KamproJournalLine[];
};

export type KamproStatementRow = {
  code: string;
  name: string;
  balance: number;
};

export type KamproExpense = {
  id: string;
  number?: number | null;
  numberLabel?: string | null;
  kind: 'GENERAL' | 'SALARIO' | 'PUBLICIDAD' | 'OTRO';
  datedAt: string;
  description: string;
  amountGrossPyg: number;
  ivaIncluded: boolean;
  treasury: TreasuryAccount;
  accountId: string;
  vendor: string | null;
  reference: string | null;
  account: { code: string; name: string };
};

export type KamproStatements = {
  from: string | null;
  to: string;
  accumulated?: boolean;
  incomeStatement: {
    income: KamproStatementRow[];
    costs: KamproStatementRow[];
    expenses: KamproStatementRow[];
    taxes: KamproStatementRow[];
    revenue: number;
    costTotal: number;
    expenseTotal: number;
    taxTotal: number;
    grossMargin: number;
    netIncome: number;
  };
  balanceSheet: {
    currentAssets: KamproStatementRow[];
    nonCurrentAssets: KamproStatementRow[];
    assets: KamproStatementRow[];
    currentLiabilities: KamproStatementRow[];
    liabilities: KamproStatementRow[];
    equity: KamproStatementRow[];
    currentAssetTotal: number;
    nonCurrentAssetTotal: number;
    assetTotal: number;
    currentLiabilityTotal: number;
    liabilityTotal: number;
    equityTotal: number;
  };
  cashFlow: {
    operating: number;
    investing: number;
    financing: number;
    opening: number;
    inflows: number;
    outflows: number;
    net: number;
    closing: number;
    lines: Array<{
      datedAt: string;
      numberLabel: string;
      memo: string;
      account: string;
      debit: number;
      credit: number;
      net: number;
      class: string;
    }>;
  };
};

export type KamproLedger = {
  account: KamproAccount;
  balance: number;
  rows: Array<{
    debit: number;
    credit: number;
    balance: number;
    memo: string | null;
    entry: { datedAt: string; numberLabel: string; memo: string };
  }>;
};
