export type SignedMovement = { productId: string; quantity: number };

/** Quantity is signed: negative = salida (venta), positive = entrada. */
export function netByProduct(movements: SignedMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const movement of movements) {
    map.set(movement.productId, (map.get(movement.productId) ?? 0) + movement.quantity);
  }
  return map;
}

export function qtyNeededBySku(lines: Array<{ sku: string; quantity: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.sku, (map.get(line.sku) ?? 0) + line.quantity);
  }
  return map;
}

export function saleDelta(currentNet: number, neededQty: number): number {
  return -neededQty - currentNet;
}
