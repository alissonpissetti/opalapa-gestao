export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Interpreta datetime sem fuso (horário de parede). */
function parseNaiveDatetime(value) {
  if (!value) return null;
  const s = String(value).trim().replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: m[4] != null ? Number(m[4]) : 9,
    mi: m[5] != null ? Number(m[5]) : 0,
    s: m[6] != null ? Number(m[6]) : 0,
  };
}

/** Formata data/hora de agendamento (valor local YYYY-MM-DDTHH:mm:ss). */
export function fmtAgendado(value) {
  if (!value) return '—';
  const p = parseNaiveDatetime(value);
  if (!p) return String(value).trim() || '—';
  const d = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Ex.: 24/04/2025 às 20:00 */
export function fmtAgendadoComAs(value) {
  if (!value) return '—';
  const p = parseNaiveDatetime(value);
  if (!p) return String(value).trim() || '—';
  const d = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  const data = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

/** Combina date + time inputs em valor datetime-local (YYYY-MM-DDTHH:mm). */
export function combineDateAndTime(dateValue, timeValue) {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  if (!date) return '';
  const hhmm = time || '09:00';
  return `${date}T${hhmm.length === 5 ? hhmm : hhmm.slice(0, 5)}`;
}

/** Separa agendado em date e time para inputs. */
export function splitAgendadoInputs(value) {
  const p = parseNaiveDatetime(value);
  if (!p) return { date: '', time: '' };
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`,
    time: `${pad(p.h)}:${pad(p.mi)}`,
  };
}

export function parseAgendadoDate(value) {
  const p = parseNaiveDatetime(value);
  if (!p) return null;
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

export function isTarefaAtrasada(agendadoPara, concluida = false) {
  if (concluida || !agendadoPara) return false;
  const d = parseAgendadoDate(agendadoPara);
  return d != null && d.getTime() < Date.now();
}

/** Valor para input datetime-local a partir do agendado da API. */
export function toDatetimeLocalValue(value) {
  const p = parseNaiveDatetime(value);
  if (!p) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export function fmtMoney(val) {
  if (val == null || val === '') return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtPercent(part, total) {
  if (total == null || total <= 0 || part == null) return null;
  const pct = (Number(part) / Number(total)) * 100;
  if (Number.isNaN(pct)) return null;
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 })}%`;
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

/**
 * Pago e faltante para a tabela de espaços (mesma base da arrecadação vinculada).
 */
export function valoresPagamentoExibidos(spaces, numero, data) {
  if (!isSaleGroupValorLeader(spaces, numero, data)) return null;
  if (data?.valorPago == null && data?.valorFalta == null) return null;

  const pago = Number(data.valorPago) || 0;
  const falta =
    data.valorFalta != null
      ? Number(data.valorFalta)
      : Math.max(0, (Number(valorNegociadoExibido(spaces, numero, data)) || 0) - pago);

  return { pago, falta };
}

/** @deprecated use valoresPagamentoExibidos */
export function valorArrecadacaoExibido(spaces, numero, data, field) {
  const vals = valoresPagamentoExibidos(spaces, numero, data);
  if (!vals) return null;
  return field === 'valorPago' ? vals.pago : vals.falta;
}
