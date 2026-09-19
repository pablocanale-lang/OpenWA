/**
 * Asientos de integración de capital (Canale y Pei) contra banco.
 * Idempotente por memo. No toca los gastos de honorarios.
 */
import 'dotenv/config';
import { CashFlowClass } from '@prisma/client';
import { prisma } from '../src/db.js';
import { postManual } from '../src/services/journal.service.js';

const AMOUNT = 1_783_663;
const DATE = new Date('2026-09-12T12:00:00-03:00');
const APORTES = ['Aporte de Canale', 'Aporte por Pei'] as const;

const banco = await prisma.account.findFirst({ where: { role: 'BANCO' } });
const capital = await prisma.account.findFirst({ where: { role: 'CAPITAL' } });
if (!banco || !capital) throw new Error('Faltan las cuentas Banco o Capital');

for (const memo of APORTES) {
  const existing = await prisma.journalEntry.findFirst({
    where: { memo, sourceType: 'MANUAL' },
    include: { reversedBy: { select: { id: true } } },
  });
  if (existing && !existing.reversedBy) {
    console.log('skip', existing.numberLabel, memo);
    continue;
  }
  const entry = await postManual(
    DATE,
    memo,
    [
      { accountId: banco.id, debit: AMOUNT, credit: 0, memo },
      { accountId: capital.id, debit: 0, credit: AMOUNT, memo },
    ],
    CashFlowClass.FINANCING,
  );
  console.log('posted', entry.numberLabel, memo, AMOUNT);
}

await prisma.$disconnect();
