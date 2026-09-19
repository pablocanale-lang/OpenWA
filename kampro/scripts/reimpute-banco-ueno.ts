import 'dotenv/config';
import { prisma } from '../src/db.js';
import { ensureSystemAccounts } from '../src/services/accounts.service.js';

await ensureSystemAccounts();

const accounts = await prisma.account.findMany({
  orderBy: { code: 'asc' },
  include: { parent: { select: { code: true } } },
});

console.log('--- ACCOUNTS ---');
for (const a of accounts) {
  const lines = await prisma.journalLine.aggregate({
    where: { accountId: a.id },
    _count: true,
    _sum: { debit: true, credit: true },
  });
  console.log(
    [a.code, a.name, `postable=${a.postable}`, `role=${a.role ?? ''}`, `parent=${a.parent?.code ?? ''}`, `lines=${lines._count}`, `debit=${lines._sum.debit ?? 0}`, `credit=${lines._sum.credit ?? 0}`].join(' | '),
  );
}

await prisma.$disconnect();
