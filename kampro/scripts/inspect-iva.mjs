import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const accounts = await p.account.findMany({
  where: {
    role: {
      in: [
        'IVA_CREDITO',
        'IVA_DEBITO',
        'BANCO',
        'CAJA',
        'GASTOS_GENERALES',
        'RESULTADOS_ACUMULADOS',
        'VENTAS',
        'PUBLICIDAD',
      ],
    },
  },
  orderBy: { code: 'asc' },
});

const ivaLines = await p.journalLine.findMany({
  where: { account: { role: { in: ['IVA_CREDITO', 'IVA_DEBITO'] } } },
  include: { account: true, entry: true },
  orderBy: [{ entry: { datedAt: 'asc' } }, { entry: { number: 'asc' } }],
});

const expenses = await p.expense.findMany({ orderBy: { datedAt: 'asc' } });

const canale = await p.journalEntry.findMany({
  where: {
    OR: [
      { memo: { contains: 'IVA' } },
      { memo: { contains: 'Canale' } },
      { memo: { contains: 'talonario' } },
    ],
  },
  include: { lines: { include: { account: true } } },
  orderBy: { number: 'asc' },
});

const pay259 = await p.journalLine.findMany({
  where: { OR: [{ debit: 259390 }, { credit: 259390 }] },
  include: { account: true, entry: true },
});
const pay214 = await p.journalLine.findMany({
  where: { OR: [{ debit: 214670 }, { credit: 214670 }] },
  include: { account: true, entry: true },
});

const trial = await p.journalLine.groupBy({
  by: ['accountId'],
  _sum: { debit: true, credit: true },
});
const accAll = await p.account.findMany({ where: { postable: true, active: true } });
const byId = new Map(trial.map((g) => [g.accountId, g._sum]));

function signed(type, debit, credit) {
  const raw = debit - credit;
  if (type === 'LIABILITY' || type === 'EQUITY' || type === 'INCOME') return credit - debit;
  return raw;
}

const rows = accAll.map((a) => {
  const s = byId.get(a.id);
  const debit = s?.debit ?? 0;
  const credit = s?.credit ?? 0;
  return { code: a.code, name: a.name, type: a.type, role: a.role, debit, credit, balance: signed(a.type, debit, credit) };
});

const assets = rows.filter((a) => a.type === 'ASSET').reduce((s, a) => s + a.balance, 0);
const liab = rows.filter((a) => a.type === 'LIABILITY').reduce((s, a) => s + a.balance, 0);
const equity = rows.filter((a) => a.type === 'EQUITY' && a.code !== '3.1.03').reduce((s, a) => s + a.balance, 0);
const income = rows.filter((a) => a.type === 'INCOME').reduce((s, a) => s + a.balance, 0);
const costs = rows.filter((a) => a.type === 'COST').reduce((s, a) => s + a.balance, 0);
const expensesT = rows.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.balance, 0);
const netIncome = income - costs - expensesT;
const equityTotal = equity + netIncome;
const difference = assets - (liab + equityTotal);

const ivaSums = {};
for (const l of ivaLines) {
  const r = l.account.role;
  if (!ivaSums[r]) ivaSums[r] = { debit: 0, credit: 0 };
  ivaSums[r].debit += l.debit;
  ivaSums[r].credit += l.credit;
}

console.log(
  JSON.stringify(
    {
      ivaSums,
      ivaBalances: rows.filter((r) => r.role === 'IVA_CREDITO' || r.role === 'IVA_DEBITO'),
      equation: { assets, liab, equity, netIncome, equityTotal, pasivoPatrimonio: liab + equityTotal, difference },
      expenses: expenses.map((e) => ({
        numberLabel: e.numberLabel,
        datedAt: e.datedAt,
        desc: e.description,
        amount: e.amountGrossPyg,
        vendor: e.vendor,
        iva: e.ivaIncluded,
      })),
      canaleEntries: canale.map((e) => ({
        n: e.numberLabel,
        date: e.datedAt,
        event: e.event,
        memo: e.memo,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        reversedBy: e.reversedBy,
        lines: e.lines.map((l) => ({ role: l.account.role, name: l.account.name, debit: l.debit, credit: l.credit })),
      })),
      ivaLines: ivaLines.map((l) => ({
        n: l.entry.numberLabel,
        date: l.entry.datedAt,
        event: l.entry.event,
        memo: l.entry.memo,
        role: l.account.role,
        debit: l.debit,
        credit: l.credit,
        reversedBy: l.entry.reversedBy,
      })),
      pay259: pay259.map((l) => ({
        n: l.entry.numberLabel,
        memo: l.entry.memo,
        role: l.account.role,
        debit: l.debit,
        credit: l.credit,
      })),
      pay214: pay214.map((l) => ({
        n: l.entry.numberLabel,
        memo: l.entry.memo,
        role: l.account.role,
        debit: l.debit,
        credit: l.credit,
      })),
      trial: rows.filter((r) => r.debit || r.credit || r.balance),
    },
    null,
    2,
  ),
);

await p.$disconnect();
