/** IVA 10% paraguayo: el precio incluye IVA y se extrae dividiendo 11. */

export function splitIva11(grossPyg: number): { gross: number; iva: number; net: number } {
  if (!Number.isInteger(grossPyg) || grossPyg < 0) {
    throw new Error('El importe con IVA debe ser un entero en guaraníes mayor o igual a 0');
  }
  const iva = Math.round(grossPyg / 11);
  return { gross: grossPyg, iva, net: grossPyg - iva };
}

export function netIfIncluded(grossPyg: number, ivaIncluded: boolean): { gross: number; iva: number; net: number } {
  if (!ivaIncluded) return { gross: grossPyg, iva: 0, net: grossPyg };
  return splitIva11(grossPyg);
}
