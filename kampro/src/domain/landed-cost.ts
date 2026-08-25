import { pygFrom } from '../money.js';

export type CostInput = {
  id: string;
  purchaseId: string | null;
  type: string;
  description: string | null;
  amount: string;
  currency: string;
  fxRateToPyg: string | null;
};

export type PurchaseInput = {
  id: string;
  productId: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  total: string;
  currency: string;
  fxRateToPyg: string | null;
  purchasedAt: Date;
  supplierName: string;
  shipmentReference: string | null;
};

export type AllocatedPurchase = {
  purchase: PurchaseInput;
  qtyReceived: number;
  purchasePyg: number | null;
  importAllocated: Array<{
    id: string;
    type: string;
    description: string | null;
    amount: string;
    currency: string;
    allocatedAmount: string;
    pyg: number | null;
    shared: boolean;
  }>;
  importPyg: number | null;
  landedPyg: number | null;
};

function round4(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

export function allocateCosts(purchases: PurchaseInput[], costs: CostInput[]): AllocatedPurchase[] {
  const totalQty = purchases.reduce((s, p) => s + p.quantity, 0);

  return purchases.map((purchase) => {
    const importAllocated: AllocatedPurchase['importAllocated'] = [];

    for (const cost of costs) {
      const amount = Number(cost.amount);
      if (!Number.isFinite(amount)) continue;

      if (cost.purchaseId && cost.purchaseId !== purchase.id) continue;

      const shared = !cost.purchaseId;
      let allocated = amount;
      if (shared) {
        allocated = totalQty === 0 ? 0 : (amount * purchase.quantity) / totalQty;
      } else if (cost.purchaseId !== purchase.id) {
        continue;
      }

      const pyg = pygFrom(allocated, cost.currency, cost.fxRateToPyg);
      importAllocated.push({
        id: cost.id,
        type: cost.type,
        description: cost.description,
        amount: cost.amount,
        currency: cost.currency,
        allocatedAmount: round4(allocated),
        pyg,
        shared,
      });
    }

    const purchasePyg = pygFrom(purchase.total, purchase.currency, purchase.fxRateToPyg);
    const importPygs = importAllocated.map((c) => c.pyg);
    const importPyg = importPygs.every((v) => v !== null) ? importPygs.reduce((s, v) => s + (v ?? 0), 0) : null;
    const landedPyg = purchasePyg !== null && importPyg !== null ? purchasePyg + importPyg : null;

    return {
      purchase,
      qtyReceived: 0,
      purchasePyg,
      importAllocated,
      importPyg,
      landedPyg,
    };
  });
}

export function totalsByCurrency(rows: AllocatedPurchase[]): Record<string, { purchase: number; import: number }> {
  const out: Record<string, { purchase: number; import: number }> = {};
  const add = (currency: string, field: 'purchase' | 'import', amount: number) => {
    const key = currency.toUpperCase();
    if (!out[key]) out[key] = { purchase: 0, import: 0 };
    out[key][field] += amount;
  };

  for (const row of rows) {
    add(row.purchase.currency, 'purchase', Number(row.purchase.total));
    for (const cost of row.importAllocated) {
      add(cost.currency, 'import', Number(cost.allocatedAmount));
    }
  }
  return out;
}
