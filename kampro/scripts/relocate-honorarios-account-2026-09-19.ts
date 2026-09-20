/**
 * Corrección de plan de cuentas: la cuenta "Gastos por honorarios" (código "7") se creó como un
 * capítulo raíz nuevo, hermano de ACTIVO/PASIVO/PATRIMONIO/INGRESOS/COSTOS/GASTOS, en vez de vivir
 * anidada bajo "6" (GASTOS). Ver hallazgo A de docs/ai/auditoria-general-2026-09-19.md.
 *
 * Solo cambia `code` y `parentId` de la cuenta — no toca ninguna JournalLine, ningún asiento ni
 * ningún monto. El accountId (la referencia real que usan las líneas contables) no cambia.
 * Idempotente: si ya está bien ubicada, no hace nada.
 *
 * Uso: npx tsx scripts/relocate-honorarios-account-2026-09-19.ts
 */
import 'dotenv/config';
import { prisma } from '../src/db.js';
import { nextChildCode } from '../src/domain/chart-of-accounts.js';

const OLD_CODE = '7';
const GASTOS_CODE = '6';

async function main() {
  const account = await prisma.account.findUnique({ where: { code: OLD_CODE } });
  if (!account) {
    console.log(`SKIP: no existe una cuenta con código ${OLD_CODE} (¿ya fue reubicada?)`);
    return;
  }
  if (account.name !== 'Gastos por honorarios') {
    throw new Error(`La cuenta ${OLD_CODE} no es "Gastos por honorarios" (es "${account.name}") — abortando por seguridad`);
  }

  const gastos = await prisma.account.findUnique({ where: { code: GASTOS_CODE } });
  if (!gastos) throw new Error(`No se encontró la cuenta padre ${GASTOS_CODE} (GASTOS)`);

  const siblings = await prisma.account.findMany({ where: { parentId: gastos.id }, select: { code: true } });
  const newCode = nextChildCode(GASTOS_CODE, siblings.map((s) => s.code));

  const clash = await prisma.account.findUnique({ where: { code: newCode } });
  if (clash) throw new Error(`El código destino ${newCode} ya está ocupado por otra cuenta (${clash.name})`);

  const linesBefore = await prisma.journalLine.count({ where: { accountId: account.id } });

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { code: newCode, parentId: gastos.id },
  });

  const linesAfter = await prisma.journalLine.count({ where: { accountId: account.id } });
  if (linesBefore !== linesAfter) throw new Error('El conteo de líneas contables cambió — esto no debería pasar');

  console.log(`OK: cuenta "${updated.name}" reubicada de código ${OLD_CODE} (raíz) a ${updated.code} (bajo ${GASTOS_CODE} GASTOS).`);
  console.log(`Líneas contables asociadas (sin cambios): ${linesAfter}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
