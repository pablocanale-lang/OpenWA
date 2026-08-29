export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COST', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_ROLES = [
  'CAJA',
  'BANCO',
  'CXC',
  'ANTICIPO_CLIENTES',
  'ANTICIPO_PROVEEDORES',
  'IVA_CREDITO',
  'IVA_DEBITO',
  'INVENTARIO',
  'TRANSITO',
  'CXP',
  'VENTAS',
  'DESCUENTOS',
  'CMV',
  'FLETE_VENTAS',
  'PUBLICIDAD',
  'SUELDOS',
  'CARGAS_SOCIALES',
  'GASTOS_BANCARIOS',
  'GASTOS_GENERALES',
  'AJUSTE_INVENTARIO',
  'CAPITAL',
  'RESULTADOS_ACUMULADOS',
  'RESULTADO_EJERCICIO',
  'BIENES_USO',
  'REMUNERACIONES_PAGAR',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type SystemAccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  parentCode: string | null;
  postable: boolean;
  role?: AccountRole;
};

export const SYSTEM_ACCOUNTS: SystemAccountSeed[] = [
  { code: '1', name: 'ACTIVO', type: 'ASSET', parentCode: null, postable: false },
  { code: '1.1', name: 'ACTIVO CORRIENTE', type: 'ASSET', parentCode: '1', postable: false },
  { code: '1.1.01', name: 'Caja', type: 'ASSET', parentCode: '1.1', postable: true, role: 'CAJA' },
  { code: '1.1.02', name: 'Banco', type: 'ASSET', parentCode: '1.1', postable: true, role: 'BANCO' },
  { code: '1.1.03', name: 'Cuentas por cobrar', type: 'ASSET', parentCode: '1.1', postable: true, role: 'CXC' },
  { code: '1.1.04', name: 'Anticipos a proveedores', type: 'ASSET', parentCode: '1.1', postable: true, role: 'ANTICIPO_PROVEEDORES' },
  { code: '1.1.05', name: 'IVA crédito fiscal', type: 'ASSET', parentCode: '1.1', postable: true, role: 'IVA_CREDITO' },
  { code: '1.1.06', name: 'Inventario de mercaderías', type: 'ASSET', parentCode: '1.1', postable: true, role: 'INVENTARIO' },
  { code: '1.1.07', name: 'Mercaderías en tránsito', type: 'ASSET', parentCode: '1.1', postable: true, role: 'TRANSITO' },
  { code: '1.2', name: 'ACTIVO NO CORRIENTE', type: 'ASSET', parentCode: '1', postable: false },
  { code: '1.2.01', name: 'Bienes de uso', type: 'ASSET', parentCode: '1.2', postable: true, role: 'BIENES_USO' },
  { code: '2', name: 'PASIVO', type: 'LIABILITY', parentCode: null, postable: false },
  { code: '2.1', name: 'PASIVO CORRIENTE', type: 'LIABILITY', parentCode: '2', postable: false },
  { code: '2.1.01', name: 'Cuentas por pagar', type: 'LIABILITY', parentCode: '2.1', postable: true, role: 'CXP' },
  { code: '2.1.02', name: 'Anticipos de clientes', type: 'LIABILITY', parentCode: '2.1', postable: true, role: 'ANTICIPO_CLIENTES' },
  { code: '2.1.03', name: 'IVA débito fiscal', type: 'LIABILITY', parentCode: '2.1', postable: true, role: 'IVA_DEBITO' },
  { code: '2.1.04', name: 'Remuneraciones a pagar', type: 'LIABILITY', parentCode: '2.1', postable: true, role: 'REMUNERACIONES_PAGAR' },
  { code: '2.1.05', name: 'Cargas sociales a pagar', type: 'LIABILITY', parentCode: '2.1', postable: true, role: 'CARGAS_SOCIALES' },
  { code: '3', name: 'PATRIMONIO', type: 'EQUITY', parentCode: null, postable: false },
  { code: '3.1.01', name: 'Capital', type: 'EQUITY', parentCode: '3', postable: true, role: 'CAPITAL' },
  { code: '3.1.02', name: 'Resultados acumulados', type: 'EQUITY', parentCode: '3', postable: true, role: 'RESULTADOS_ACUMULADOS' },
  { code: '3.1.03', name: 'Resultado del ejercicio', type: 'EQUITY', parentCode: '3', postable: true, role: 'RESULTADO_EJERCICIO' },
  { code: '4', name: 'INGRESOS', type: 'INCOME', parentCode: null, postable: false },
  { code: '4.1.01', name: 'Ventas de mercaderías', type: 'INCOME', parentCode: '4', postable: true, role: 'VENTAS' },
  { code: '4.1.02', name: 'Descuentos concedidos', type: 'INCOME', parentCode: '4', postable: true, role: 'DESCUENTOS' },
  { code: '5', name: 'COSTOS', type: 'COST', parentCode: null, postable: false },
  { code: '5.1.01', name: 'Costo de mercaderías vendidas', type: 'COST', parentCode: '5', postable: true, role: 'CMV' },
  { code: '6', name: 'GASTOS', type: 'EXPENSE', parentCode: null, postable: false },
  { code: '6.1.01', name: 'Flete y envíos', type: 'EXPENSE', parentCode: '6', postable: true, role: 'FLETE_VENTAS' },
  { code: '6.1.02', name: 'Publicidad', type: 'EXPENSE', parentCode: '6', postable: true, role: 'PUBLICIDAD' },
  { code: '6.1.03', name: 'Sueldos', type: 'EXPENSE', parentCode: '6', postable: true, role: 'SUELDOS' },
  { code: '6.1.04', name: 'Aportes patronales', type: 'EXPENSE', parentCode: '6', postable: true },
  { code: '6.1.05', name: 'Gastos bancarios', type: 'EXPENSE', parentCode: '6', postable: true, role: 'GASTOS_BANCARIOS' },
  { code: '6.1.06', name: 'Gastos generales', type: 'EXPENSE', parentCode: '6', postable: true, role: 'GASTOS_GENERALES' },
  { code: '6.1.07', name: 'Ajustes de inventario', type: 'EXPENSE', parentCode: '6', postable: true, role: 'AJUSTE_INVENTARIO' },
];

export function nextChildCode(parentCode: string, siblingCodes: string[]): string {
  const prefix = `${parentCode}.`;
  const children = siblingCodes.filter((code) => code.startsWith(prefix));
  const lastParts = children
    .map((code) => Number(code.slice(prefix.length).split('.').at(-1)))
    .filter((n) => Number.isInteger(n) && n > 0);
  const next = (lastParts.length ? Math.max(...lastParts) : 0) + 1;
  const padded = String(next).padStart(2, '0');
  const sample = children[0];
  if (sample) {
    const rest = sample.slice(prefix.length);
    const segs = rest.split('.');
    if (segs.length > 1) {
      return `${parentCode}.${segs.slice(0, -1).join('.')}.${padded}`;
    }
  }
  return `${prefix}${padded}`;
}
