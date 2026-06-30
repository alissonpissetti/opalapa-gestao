/**
 * Normaliza telefone brasileiro para apenas dígitos com prefixo 55.
 */
export function normalizeBrCellphone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits.length) return null;
  if (digits.startsWith('55')) {
    if (digits.length < 12 || digits.length > 15) return null;
    return digits;
  }
  if (digits.length === 11 || digits.length === 10) {
    return `55${digits}`;
  }
  return null;
}

/**
 * Destinatário Comtele: DDD + número, sem prefixo 55.
 */
export function toComteleReceivers(normalizedWith55) {
  const d = String(normalizedWith55 || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) {
    return d.slice(2);
  }
  return d;
}
