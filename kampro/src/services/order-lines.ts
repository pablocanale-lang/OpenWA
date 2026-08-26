import { discountPercentForQty, quoteTotalPyg } from '../domain/order-pricing.js';
import { badRequest } from '../http-error.js';
import { prisma } from '../db.js';

export type OrderLineInput = {
  sku: string;
  quantity: number;
  discountApplied?: number;
  unitPricePyg?: number;
};

export type ResolvedOrderLine = {
  sku: string;
  productName: string;
  quantity: number;
  unitPricePyg: number;
  discountApplied: number;
  lineTotal: number;
  sortOrder: number;
};

export function summarizeLines(lines: ResolvedOrderLine[]) {
  return {
    sku: lines.map((l) => l.sku).join(', '),
    productName: lines.map((l) => `${l.productName} ×${l.quantity}`).join(', '),
    quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    discountApplied: lines.length === 1 ? lines[0]!.discountApplied : 0,
    totalAmount: lines.reduce((sum, l) => sum + l.lineTotal, 0),
  };
}

export async function resolveOrderLines(input: {
  items?: OrderLineInput[];
  sku?: string;
  quantity?: number;
  discountApplied?: number;
}): Promise<ResolvedOrderLine[]> {
  const raw: OrderLineInput[] =
    input.items && input.items.length > 0
      ? input.items
      : input.sku
        ? [
            {
              sku: input.sku,
              quantity: input.quantity ?? 1,
              discountApplied: input.discountApplied,
            },
          ]
        : [];

  if (raw.length < 1) badRequest('El pedido debe tener al menos un producto');

  const lines: ResolvedOrderLine[] = [];
  for (const [index, row] of raw.entries()) {
    const product = await prisma.product.findUnique({ where: { sku: row.sku } });
    if (!product) badRequest(`SKU desconocido: ${row.sku}`);
    const quantity = Math.round(row.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) badRequest('La cantidad debe ser al menos 1');
    const discountApplied =
      row.discountApplied !== undefined ? Math.round(row.discountApplied) : discountPercentForQty(quantity);
    if (discountApplied < 0 || discountApplied > 100) badRequest('Descuento inválido');
    const unitPricePyg = Math.round(row.unitPricePyg ?? product.unitPricePyg ?? 0);
    if (!Number.isFinite(unitPricePyg) || unitPricePyg < 0) badRequest('Precio unitario inválido');
    const lineTotal = quoteTotalPyg(unitPricePyg, quantity, discountApplied);
    lines.push({
      sku: product.sku,
      productName: product.name,
      quantity,
      unitPricePyg,
      discountApplied,
      lineTotal,
      sortOrder: index,
    });
  }

  const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (totalAmount < 1) badRequest('El monto a pagar debe ser mayor a 0. Revisá precios de venta en Productos.');
  return lines;
}
