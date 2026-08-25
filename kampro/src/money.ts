import { Prisma } from '@prisma/client';

export function dec(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function decMul(a: string | number | Prisma.Decimal, b: string | number | Prisma.Decimal): Prisma.Decimal {
  return dec(a).mul(dec(b));
}

export function asString(value: Prisma.Decimal | string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return dec(value).toFixed();
}

export function pygFrom(amount: string | number | Prisma.Decimal, currency: string, fxRateToPyg: string | number | Prisma.Decimal | null | undefined): number | null {
  const n = Number(dec(amount).toString());
  if (!Number.isFinite(n)) return null;
  if (currency.toUpperCase() === 'PYG') return Math.round(n);
  if (fxRateToPyg === null || fxRateToPyg === undefined) return null;
  const fx = Number(dec(fxRateToPyg).toString());
  if (!Number.isFinite(fx) || fx <= 0) return null;
  return Math.round(n * fx);
}
