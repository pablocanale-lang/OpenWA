/**
 * Corrección histórica: PV-000015 a PV-000019 nunca tuvieron movimiento real de Caja — todo el
 * efectivo cobrado se depositó al banco de inmediato. Además, PV-000016 a PV-000019 se vendieron
 * a Gs. 600.000 parejo, pero el sistema solo permitía descuento en % entero (OrderLine.discountApplied
 * es Int), y 6,25% (el % exacto para llegar a 600.000 desde el precio de lista 640.000) no es
 * representable — quedó en 6%, dejando un residuo de Gs. 1.600 por pedido que se cargó como si
 * fuera "flete" para forzar el cuadre. En PV-000016 ese residuo se sumó a un flete real de 30.000
 * (total 31.600). En PV-000017/018/019 no hubo flete real: el "flete" de 1.600 es 100% ficticio.
 *
 * Confirmado por el usuario (2026-09-20). Ver docs/ai/reconciliacion-2026-09-20 (Excel).
 *
 * Efecto neto sobre el saldo de Banco: CERO (son las mismas platas que ya estaban, mal rotuladas
 * entre Caja/Banco vía depósitos manuales-parche). Efecto real: Caja queda en cero SIN ninguna
 * línea (nunca tuvo movimiento real), Ventas baja Gs. 6.400 en total (4 × 1.600), y se eliminan
 * los 2 asientos manuales que parcheaban el descuadre de Caja.
 *
 * Mismo criterio "sin rastro" que las correcciones anteriores: se edita el mismo asiento (mismo
 * número, misma fecha), sin nota de corrección. Idempotente.
 *
 * Uso: npx tsx scripts/fix-caja-banco-pv015-019-2026-09-20.ts
 */
import 'dotenv/config';
import { PaymentMethod } from '@prisma/client';
import { prisma } from '../src/db.js';
import { rewriteActiveEntry } from '../src/services/journal.service.js';

async function getEntry(numberLabel: string) {
  return prisma.journalEntry.findUnique({
    where: { numberLabel },
    include: { lines: { include: { account: true } } },
  });
}

async function reclassifyTreasuryAndAmount(
  numberLabel: string,
  opts: { newAmount?: number; fromRole: 'CAJA'; toRole: 'BANCO'; adjustRole?: string },
) {
  const entry = await getEntry(numberLabel);
  if (!entry) {
    console.log(`SKIP ${numberLabel}: no existe`);
    return;
  }
  const fromLine = entry.lines.find((l) => l.account.role === opts.fromRole);
  if (!fromLine) {
    console.log(`SKIP ${numberLabel}: ya no tiene línea ${opts.fromRole}`);
    return;
  }
  const toAccount = await prisma.account.findUniqueOrThrow({ where: { role: opts.toRole } });
  const oldAmount = fromLine.debit || fromLine.credit;
  const newAmount = opts.newAmount ?? oldAmount;
  const delta = newAmount - oldAmount;

  const newLines = entry.lines.map((l) => {
    if (l.id === fromLine.id) {
      return {
        accountId: toAccount.id,
        debit: fromLine.debit > 0 ? newAmount : 0,
        credit: fromLine.credit > 0 ? newAmount : 0,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      };
    }
    if (opts.adjustRole && l.account.role === opts.adjustRole && delta !== 0) {
      return {
        accountId: l.accountId,
        debit: l.debit > 0 ? l.debit + delta : l.debit,
        credit: l.credit > 0 ? l.credit + delta : l.credit,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      };
    }
    return {
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo ?? undefined,
      productId: l.productId ?? undefined,
      quantity: l.quantity ?? undefined,
    };
  });

  await prisma.$transaction((tx) =>
    rewriteActiveEntry(tx, {
      datedAt: entry.datedAt,
      memo: entry.memo,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      event: entry.event,
      lines: newLines,
    }),
  );
  console.log(`OK ${numberLabel}: ${opts.fromRole} ${oldAmount} -> ${opts.toRole} ${newAmount}`);
}

async function adjustAmountOnly(numberLabel: string, newAmount: number, roles: string[]) {
  const entry = await getEntry(numberLabel);
  if (!entry) {
    console.log(`SKIP ${numberLabel}: no existe`);
    return;
  }
  const targets = entry.lines.filter((l) => l.account.role && roles.includes(l.account.role));
  if (targets.length === 0) {
    console.log(`SKIP ${numberLabel}: no tiene líneas en ${roles.join('/')}`);
    return;
  }
  const oldAmount = targets[0]!.debit || targets[0]!.credit;
  if (oldAmount === newAmount) {
    console.log(`SKIP ${numberLabel}: ya está en ${newAmount}`);
    return;
  }
  const newLines = entry.lines.map((l) => {
    if (l.account.role && roles.includes(l.account.role)) {
      return {
        accountId: l.accountId,
        debit: l.debit > 0 ? newAmount : 0,
        credit: l.credit > 0 ? newAmount : 0,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      };
    }
    return {
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo ?? undefined,
      productId: l.productId ?? undefined,
      quantity: l.quantity ?? undefined,
    };
  });
  await prisma.$transaction((tx) =>
    rewriteActiveEntry(tx, {
      datedAt: entry.datedAt,
      memo: entry.memo,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      event: entry.event,
      lines: newLines,
    }),
  );
  console.log(`OK ${numberLabel}: ${oldAmount} -> ${newAmount}`);
}

async function deleteEntry(numberLabel: string, reason: string) {
  const entry = await getEntry(numberLabel);
  if (!entry) {
    console.log(`SKIP ${numberLabel}: ya no existe`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
    await tx.journalEntry.delete({ where: { id: entry.id } });
  });
  console.log(`OK eliminado ${numberLabel} (${reason})`);
}

async function fixOrderPricing(numberLabel: string, newTotal: number) {
  const order = await prisma.order.findUnique({ where: { numberLabel }, include: { items: true } });
  if (!order) {
    console.log(`SKIP ${numberLabel}: pedido no encontrado`);
    return;
  }
  if (order.items.length !== 1) throw new Error(`${numberLabel}: se esperaba 1 sola línea de pedido`);
  const line = order.items[0]!;
  if (line.lineTotal === newTotal && order.totalAmount === newTotal) {
    console.log(`SKIP ${numberLabel}: ya está en ${newTotal}`);
    return;
  }
  await prisma.$transaction([
    prisma.orderLine.update({ where: { id: line.id }, data: { lineTotal: newTotal } }),
    prisma.order.update({ where: { id: order.id }, data: { totalAmount: newTotal } }),
  ]);
  console.log(`OK ${numberLabel}: OrderLine/Order total ${line.lineTotal} -> ${newTotal}`);
}

async function fixPayment(numberLabel: string, newAmount?: number, newMethod?: PaymentMethod) {
  const order = await prisma.order.findUnique({ where: { numberLabel }, include: { payments: true } });
  if (!order) {
    console.log(`SKIP ${numberLabel}: pedido no encontrado`);
    return;
  }
  const confirmed = order.payments.filter((p) => p.status === 'CONFIRMADO');
  if (confirmed.length !== 1) throw new Error(`${numberLabel}: se esperaba 1 solo pago confirmado`);
  const pay = confirmed[0]!;
  const data: { amount?: number; method?: PaymentMethod } = {};
  if (newAmount !== undefined && pay.amount !== newAmount) data.amount = newAmount;
  if (newMethod !== undefined && pay.method !== newMethod) data.method = newMethod;
  if (Object.keys(data).length === 0) {
    console.log(`SKIP ${numberLabel}: Payment ya está correcto`);
    return;
  }
  await prisma.payment.update({ where: { id: pay.id }, data });
  console.log(`OK ${numberLabel}: Payment ${JSON.stringify(data)}`);
}

async function fixShippingField(numberLabel: string, newShippingCostPyg: number | null) {
  const order = await prisma.order.findUnique({ where: { numberLabel } });
  if (!order) {
    console.log(`SKIP ${numberLabel}: pedido no encontrado`);
    return;
  }
  if (order.shippingCostPyg === newShippingCostPyg && order.shippingTreasury === 'BANCO') {
    console.log(`SKIP ${numberLabel}: shippingCostPyg ya está en ${newShippingCostPyg}`);
    return;
  }
  await prisma.order.update({
    where: { id: order.id },
    data: { shippingCostPyg: newShippingCostPyg, shippingTreasury: 'BANCO' },
  });
  console.log(`OK ${numberLabel}: shippingCostPyg -> ${newShippingCostPyg}, shippingTreasury -> BANCO`);
}

async function verifyLedgerBalance() {
  const sums = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  const debit = sums._sum.debit ?? 0;
  const credit = sums._sum.credit ?? 0;
  console.log(`\nVerificación final: total débitos=${debit} total créditos=${credit}`);
  if (debit !== credit) throw new Error(`LIBRO DESBALANCEADO: débito=${debit} crédito=${credit}`);
  console.log('OK: el libro sigue balanceado.');
}

async function reportBalances() {
  for (const role of ['CAJA', 'BANCO'] as const) {
    const acc = await prisma.account.findUnique({ where: { role } });
    if (!acc) continue;
    const sums = await prisma.journalLine.aggregate({ where: { accountId: acc.id }, _sum: { debit: true, credit: true } });
    const debit = sums._sum.debit ?? 0;
    const credit = sums._sum.credit ?? 0;
    const count = await prisma.journalLine.count({ where: { accountId: acc.id } });
    console.log(`${role}: lineas=${count} debit=${debit} credit=${credit} saldo=${debit - credit}`);
  }
}

async function main() {
  console.log('=== PV-000015: cobro efectivo -> banco (sin cambio de monto) ===');
  await fixPayment('PV-000015', undefined, PaymentMethod.TRANSFERENCIA);
  await reclassifyTreasuryAndAmount('A-000075', { fromRole: 'CAJA', toRole: 'BANCO' });

  console.log('\n=== PV-000016: precio real 600.000 (era 601.600) + flete real 30.000 (era 31.600) a Banco ===');
  await fixOrderPricing('PV-000016', 600_000);
  await fixPayment('PV-000016', 600_000);
  await adjustAmountOnly('A-000080', 600_000, ['ANTICIPO_CLIENTES', 'VENTAS']);
  await adjustAmountOnly('A-000078', 600_000, ['BANCO', 'ANTICIPO_CLIENTES']);
  await reclassifyTreasuryAndAmount('A-000079', { newAmount: 30_000, fromRole: 'CAJA', toRole: 'BANCO', adjustRole: 'FLETE_VENTAS' });
  await fixShippingField('PV-000016', 30_000);

  console.log('\n=== PV-000017: precio real 600.000, cobro efectivo -> banco, flete ficticio eliminado ===');
  await fixOrderPricing('PV-000017', 600_000);
  await fixPayment('PV-000017', 600_000, PaymentMethod.TRANSFERENCIA);
  await adjustAmountOnly('A-000101', 600_000, ['ANTICIPO_CLIENTES', 'VENTAS']);
  await reclassifyTreasuryAndAmount('A-000100', {
    newAmount: 600_000,
    fromRole: 'CAJA',
    toRole: 'BANCO',
    adjustRole: 'ANTICIPO_CLIENTES',
  });
  await deleteEntry('A-000099', 'flete ficticio PV-000017, residuo de redondeo de descuento');
  await deleteEntry('A-000103', 'depósito manual redundante, PV-000017 ya se postea directo a Banco');
  await fixShippingField('PV-000017', null);

  console.log('\n=== PV-000018: precio real 600.000, sin flete ===');
  await fixOrderPricing('PV-000018', 600_000);
  await fixPayment('PV-000018', 600_000);
  await adjustAmountOnly('A-000107', 600_000, ['ANTICIPO_CLIENTES', 'VENTAS']);
  await adjustAmountOnly('A-000105', 600_000, ['BANCO', 'ANTICIPO_CLIENTES']);
  await deleteEntry('A-000106', 'flete ficticio PV-000018, residuo de redondeo de descuento');
  await fixShippingField('PV-000018', null);

  console.log('\n=== PV-000019: precio real 600.000, sin flete ===');
  await fixOrderPricing('PV-000019', 600_000);
  await fixPayment('PV-000019', 600_000);
  await adjustAmountOnly('A-000111', 600_000, ['ANTICIPO_CLIENTES', 'VENTAS']);
  await adjustAmountOnly('A-000109', 600_000, ['BANCO', 'ANTICIPO_CLIENTES']);
  await deleteEntry('A-000110', 'flete ficticio PV-000019, residuo de redondeo de descuento');
  await fixShippingField('PV-000019', null);

  console.log('\n=== Eliminando los 2 asientos manuales que parcheaban el descuadre de Caja ===');
  await deleteEntry('A-000083', 'depósito manual, Caja nunca tuvo el efectivo realmente');
  await deleteEntry('A-000118', 'ajuste de caja manual, deja de tener sentido sin los parches anteriores');

  await reportBalances();
  await verifyLedgerBalance();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
