import { AccountType, type AccountRole, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import {
  BANCO_PARENT_CODE,
  isUenoPygName,
  isUenoUsdName,
  nextChildCode,
  SYSTEM_ACCOUNTS,
  UENO_PYG_CODE,
  UENO_USD_CODE,
  type AccountRole as DomainRole,
  type SystemAccountSeed,
} from '../domain/chart-of-accounts.js';

type Tx = Prisma.TransactionClient;

export async function ensureSystemAccounts() {
  for (const seed of SYSTEM_ACCOUNTS) {
    const parent = seed.parentCode
      ? await prisma.account.findUnique({ where: { code: seed.parentCode } })
      : null;
    if (seed.parentCode && !parent) continue;

    let existing = await prisma.account.findUnique({ where: { code: seed.code } });
    if (!existing) {
      const adopted = await findAccountToAdopt(seed, parent?.id ?? null);
      if (adopted) {
        await takeCode(adopted.id, seed.code, parent?.id ?? null);
        existing = await prisma.account.findUniqueOrThrow({ where: { id: adopted.id } });
      }
    }

    if (existing) {
      const data: Prisma.AccountUpdateInput = {};
      if (seed.role && existing.role !== seed.role) {
        const taken = await prisma.account.findFirst({ where: { role: seed.role, NOT: { id: existing.id } } });
        if (!taken) data.role = seed.role as AccountRole;
      }
      if (existing.postable !== seed.postable) {
        if (!seed.postable) {
          const lines = await prisma.journalLine.count({ where: { accountId: existing.id } });
          if (lines === 0) data.postable = false;
        } else {
          data.postable = true;
        }
      }
      const parentId = parent?.id ?? null;
      if (existing.parentId !== parentId) {
        data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
      }
      if (Object.keys(data).length) {
        await prisma.account.update({ where: { id: existing.id }, data });
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
  await migrateBancoLinesToUenoPyg();
}

async function findAccountToAdopt(seed: SystemAccountSeed, parentId: string | null) {
  const candidates = await prisma.account.findMany({
    where: { type: seed.type as AccountType, active: true },
    orderBy: { code: 'asc' },
  });
  const hits =
    seed.code === UENO_PYG_CODE
      ? candidates.filter((row) => isUenoPygName(row.name) || row.name.includes('6193146823'))
      : seed.code === UENO_USD_CODE
        ? candidates.filter((row) => isUenoUsdName(row.name) || row.name.includes('6113146824'))
        : candidates.filter((row) => row.name.trim().toLowerCase() === seed.name.trim().toLowerCase());
  const allowed = hits.filter((row) => !row.role || row.role === (seed.role ?? null));
  if (allowed.length) {
    return allowed.find((row) => row.parentId === parentId) ?? allowed[0];
  }
  if (parentId && seed.code === UENO_PYG_CODE) {
    const children = candidates.filter((row) => row.parentId === parentId && !row.role);
    const rest = children.filter((row) => !isUenoUsdName(row.name));
    if (rest.length === 1) return rest[0];
  }
  if (parentId && seed.code === UENO_USD_CODE) {
    const children = candidates.filter((row) => row.parentId === parentId && !row.role);
    const usd = children.filter((row) => isUenoUsdName(row.name));
    if (usd.length === 1) return usd[0];
  }
  return null;
}

async function takeCode(accountId: string, code: string, parentId: string | null) {
  const occupant = await prisma.account.findUnique({ where: { code } });
  if (occupant && occupant.id !== accountId) {
    await prisma.journalLine.updateMany({ where: { accountId: occupant.id }, data: { accountId } });
    await prisma.account.delete({ where: { id: occupant.id } });
  }
  await prisma.account.update({
    where: { id: accountId },
    data: { code, parentId, postable: true, system: true, active: true },
  });
}

/** Mueve el saldo histórico de Banco a UENO BANK PYG 6193146823 y deja Banco como padre. */
export async function migrateBancoLinesToUenoPyg() {
  await prisma.$transaction(async (tx) => {
    const banco = await tx.account.findUnique({ where: { code: BANCO_PARENT_CODE } });
    let pyg =
      (await tx.account.findFirst({ where: { name: { contains: '6193146823' } } })) ??
      (await tx.account.findUnique({ where: { code: UENO_PYG_CODE } }));
    if (!banco || !pyg || pyg.id === banco.id) return;

    if (pyg.code !== UENO_PYG_CODE || pyg.parentId !== banco.id) {
      const occupant = await tx.account.findUnique({ where: { code: UENO_PYG_CODE } });
      if (occupant && occupant.id !== pyg.id) {
        await tx.journalLine.updateMany({ where: { accountId: occupant.id }, data: { accountId: pyg.id } });
        await tx.account.delete({ where: { id: occupant.id } });
      }
      pyg = await tx.account.update({
        where: { id: pyg.id },
        data: { code: UENO_PYG_CODE, parentId: banco.id, postable: true, active: true },
      });
    }

    const usd =
      (await tx.account.findFirst({ where: { name: { contains: '6113146824' } } })) ??
      (await tx.account.findUnique({ where: { code: UENO_USD_CODE } }));
    if (usd && usd.id !== pyg.id && usd.id !== banco.id && (usd.code !== UENO_USD_CODE || usd.parentId !== banco.id)) {
      const occupant = await tx.account.findUnique({ where: { code: UENO_USD_CODE } });
      if (occupant && occupant.id !== usd.id) {
        await tx.journalLine.updateMany({ where: { accountId: occupant.id }, data: { accountId: usd.id } });
        await tx.account.delete({ where: { id: occupant.id } });
      }
      await tx.account.update({
        where: { id: usd.id },
        data: { code: UENO_USD_CODE, parentId: banco.id, postable: true, active: true },
      });
    }

    if (banco.role === 'BANCO') {
      await tx.account.update({ where: { id: banco.id }, data: { role: null } });
    }
    const holder = await tx.account.findFirst({ where: { role: 'BANCO', NOT: { id: pyg.id } } });
    if (holder) {
      await tx.account.update({ where: { id: holder.id }, data: { role: null } });
    }
    if (pyg.role !== 'BANCO') {
      await tx.account.update({ where: { id: pyg.id }, data: { role: 'BANCO', postable: true } });
    }

    const moved = await tx.journalLine.updateMany({
      where: { accountId: banco.id },
      data: { accountId: pyg.id },
    });
    if (moved.count) {
      console.info(`Kampro: ${moved.count} líneas de Banco pasaron a ${pyg.code} ${pyg.name}`);
    }

    if (banco.postable || banco.role) {
      await tx.account.update({
        where: { id: banco.id },
        data: { postable: false, role: null },
      });
    }
  });
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
