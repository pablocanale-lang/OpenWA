export type FifoLot = {
  id: string;
  receivedAt: Date | number;
  qtyRemaining: number;
  unitCostPyg: number;
};

export type FifoTake = {
  lotId: string;
  quantity: number;
  unitCostPyg: number;
  costPyg: number;
};

function lotTime(lot: FifoLot): number {
  const value = lot.receivedAt;
  return value instanceof Date ? value.getTime() : value;
}

export function consumeFifo(lots: FifoLot[], qty: number): { takes: FifoTake[]; totalCostPyg: number } {
  if (!Number.isInteger(qty) || qty < 0) throw new Error('La cantidad PEPS debe ser un entero ≥ 0');
  if (qty === 0) return { takes: [], totalCostPyg: 0 };

  const ordered = [...lots].sort((a, b) => {
    const dt = lotTime(a) - lotTime(b);
    return dt !== 0 ? dt : a.id.localeCompare(b.id);
  });

  let left = qty;
  const takes: FifoTake[] = [];
  for (const lot of ordered) {
    if (left <= 0) break;
    const take = Math.min(Math.max(0, lot.qtyRemaining), left);
    if (take <= 0) continue;
    takes.push({
      lotId: lot.id,
      quantity: take,
      unitCostPyg: lot.unitCostPyg,
      costPyg: take * lot.unitCostPyg,
    });
    left -= take;
  }
  if (left > 0) {
    throw new Error(`No hay stock PEPS suficiente (faltan ${left} unidades)`);
  }
  return { takes, totalCostPyg: takes.reduce((sum, row) => sum + row.costPyg, 0) };
}

export function applyTakesToLots(lots: FifoLot[], takes: FifoTake[]): FifoLot[] {
  const byId = new Map(lots.map((lot) => [lot.id, { ...lot }]));
  for (const take of takes) {
    const lot = byId.get(take.lotId);
    if (!lot) throw new Error('Lote PEPS no encontrado');
    lot.qtyRemaining -= take.quantity;
    if (lot.qtyRemaining < 0) throw new Error('El lote PEPS no puede quedar negativo');
  }
  return [...byId.values()];
}
