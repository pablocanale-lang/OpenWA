/** IVA paraguayo incluido en el precio: 10% se extrae ÷11 y 5% ÷21. */

export const IVA_TREATMENTS = ['IVA_10', 'IVA_5', 'EXENTA'] as const;
export type IvaTreatment = (typeof IVA_TREATMENTS)[number];

export type IvaSplit = { gross: number; iva: number; net: number };

function assertGross(grossPyg: number) {
  if (!Number.isInteger(grossPyg) || grossPyg < 0) {
    throw new Error('El importe con IVA debe ser un entero en guaraníes mayor o igual a 0');
  }
}

function splitByDivisor(grossPyg: number, divisor: number): IvaSplit {
  assertGross(grossPyg);
  const iva = Math.round(grossPyg / divisor);
  return { gross: grossPyg, iva, net: grossPyg - iva };
}

/** IVA 10%: el precio incluye IVA y se extrae dividiendo 11. */
export function splitIva11(grossPyg: number): IvaSplit {
  return splitByDivisor(grossPyg, 11);
}

/** IVA 5%: el precio incluye IVA y se extrae dividiendo 21. */
export function splitIva21(grossPyg: number): IvaSplit {
  return splitByDivisor(grossPyg, 21);
}

export function splitByTreatment(grossPyg: number, treatment: IvaTreatment): IvaSplit {
  if (treatment === 'EXENTA') {
    assertGross(grossPyg);
    return { gross: grossPyg, iva: 0, net: grossPyg };
  }
  if (treatment === 'IVA_5') return splitIva21(grossPyg);
  return splitIva11(grossPyg);
}

export function netIfIncluded(grossPyg: number, ivaIncluded: boolean): IvaSplit {
  return splitByTreatment(grossPyg, ivaIncluded ? 'IVA_10' : 'EXENTA');
}

export function resolveIvaTreatment(input: {
  ivaTreatment?: IvaTreatment | null;
  ivaIncluded?: boolean;
  kind?: string;
}): IvaTreatment {
  if (input.ivaTreatment && (IVA_TREATMENTS as readonly string[]).includes(input.ivaTreatment)) {
    return input.ivaTreatment;
  }
  if (input.ivaIncluded === false) return 'EXENTA';
  if (input.ivaIncluded === true) return 'IVA_10';
  return input.kind === 'SALARIO' || input.kind === 'IMPUESTO' ? 'EXENTA' : 'IVA_10';
}

export function ivaIncludedFrom(treatment: IvaTreatment): boolean {
  return treatment !== 'EXENTA';
}
