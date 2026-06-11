export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMoney(val) {
  if (val == null || val === '') return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseValor(str) {
  if (!str || !String(str).trim()) return null;
  const digits = String(str).replace(/\D/g, '');
  if (!digits) return null;
  return parseInt(digits, 10) / 100;
}

export function formatValorInput(val) {
  if (val == null || val === '') return '';
  return Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function maskValorInput(el) {
  const digits = el.value.replace(/\D/g, '');
  if (!digits) {
    el.value = '';
    return;
  }
  const val = parseInt(digits, 10) / 100;
  el.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sortIds(ids) {
  return [...ids].map(Number).sort((a, b) => a - b);
}

export function idsLabel(ids) {
  return sortIds(ids).map((id) => `Espaço ${id}`).join(', ');
}

/** Menor número do grupo — onde o valor total da venda é exibido/contado. */
export function saleGroupLeader(spaces, saleGroup) {
  if (!saleGroup) return null;
  const numeros = Object.values(spaces)
    .filter((s) => s.saleGroup === saleGroup)
    .map((s) => Number(s.numero))
    .sort((a, b) => a - b);
  return numeros[0] ?? null;
}

export function isSaleGroupValorLeader(spaces, numero, data) {
  if (!data?.saleGroup) return true;
  return Number(numero) === saleGroupLeader(spaces, data.saleGroup);
}

export function valorNegociadoExibido(spaces, numero, data) {
  if (data.valor == null) return null;
  if (!isSaleGroupValorLeader(spaces, numero, data)) return null;
  return data.valor;
}
