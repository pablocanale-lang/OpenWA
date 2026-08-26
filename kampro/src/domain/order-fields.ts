import { badRequest } from '../http-error.js';

/** RUC paraguayo: solo dígitos y un guion opcional (ej. 80012345-1). */
export function sanitizeRuc(raw: string): string {
  return raw.replace(/[^0-9-]/g, '');
}

export function assertRuc(raw: string): string {
  const value = sanitizeRuc(raw).trim();
  if (!value || !/\d/.test(value)) badRequest('RUC es obligatorio y solo admite números y guion');
  if (!/^\d+(-\d+)?$/.test(value)) badRequest('RUC solo admite números y un guion (ej. 80012345-1)');
  return value;
}

/** Normaliza el horario a ISO. Acepta datetime-local (YYYY-MM-DDTHH:mm) o ISO. */
export function assertPreferredDateTime(raw: string): string {
  const value = raw.trim();
  if (!value) badRequest('Horario de preferencia es obligatorio para Asunción');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    badRequest('Horario de preferencia debe ser una fecha y hora válidas');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) badRequest('Horario de preferencia debe ser una fecha y hora válidas');
  return parsed.toISOString();
}
