import { AccountType, type AccountRole, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { nextChildCode, SYSTEM_ACCOUNTS, type AccountRole as DomainRole } from '../domain/chart-of-accounts.js';

type Tx = Prisma.TransactionClient;

export async function ensureSystemAccounts() {
  for (const seed of SYSTEM_ACCOUNTS) {
    const parent = seed.parentCode
      ? await prisma.account.findUnique({ where: { code: seed.parentCode } })
      : null;
    if (seed.parentCode && !parent) continue;
    const existing = await prisma.account.findUnique({ where: { code: seed.code } });
    if (existing) {
      if (seed.role && existing.role !== seed.role) {
        const taken = await prisma.account.findFirst({ where: { role: seed.role, NOT: { id: existing.id } } });
        if (!taken) {
          await prisma.account.update({ where: { id: existing.id }, data: { role: seed.role as AccountRole } });
        }
      }
      continue;
    }
    await prisma.account.create({
      data: {
        code: seed.code,
        name: seed.name,
        type: seed.type as AccountType,
        role: (seed.role as AccountRole | undefined) ?? null,
        parentId: parent?.id ?? null,
        postable: seed.postable,
        system: true,
        active: true,
      },
    });
  }
}

export async function listAccounts() {
  return prisma.account.findMany({
    where: { active: true },
    orderBy: { code: 'asc' },
    include: { parent: { select: { id: true, code: true, name: true } } },
  });
}

export async function getAccount(id: string) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) notFound('Cuenta');
  return account;
}

export async function roleIds(tx: Tx | typeof prisma = prisma): Promise<Map<DomainRole, string>> {
  const rows = await tx.account.findMany({ where: { role: { not: null } } });
  const map = new Map<DomainRole, string>();
  for (const row of rows) {
    if (row.role) map.set(row.role as DomainRole, row.id);
  }
  return map;
}

export async function createAccount(input: {
  name: string;
  type: AccountType;
  parentId?: string | null;
  postable?: boolean;
}) {
  const name = input.name.trim();
  if (!name) badRequest('El nombre de la cuenta es obligatorio');
  let parentCode = '';
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await getAccount(input.parentId);
    parentId = parent.id;
    parentCode = parent.code;
    if (parent.type !== input.type) {
      badRequest('La cuenta hija tiene que ser del mismo tipo que la cuenta padre');
    }
  }
  const siblings = await prisma.account.findMany({
    where: parentId ? { parentId } : { parentId: null },
    select: { code: true },
  });
  const finalCode = parentCode
    ? nextChildCode(
        parentCode,
        siblings.map((s) => s.code),
      )
    : suggestRootCode(
        siblings.map((s) => s.code),
        input.type,
      );
  return prisma.account.create({
    data: {
      code: finalCode,
      name,
      type: input.type,
      parentId,
      postable: input.postable ?? true,
      system: false,
      active: true,
    },
  });
}

function suggestRootCode(existing: string[], type: AccountType): string {
  const byType: Record<AccountType, string> = {
    ASSET: '1',
    LIABILITY: '2',
    EQUITY: '3',
    INCOME: '4',
    COST: '5',
    EXPENSE: '6',
  };
  const base = byType[type];
  if (!existing.includes(base)) return base;
  const nums = existing.map((c) => Number(c.split('.')[0])).filter((n) => Number.isInteger(n));
  return String((nums.length ? Math.max(...nums) : 6) + 1);
}
