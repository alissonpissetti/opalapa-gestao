/** Data de corte para fase: último dia do evento (dt_fim, ou dt_inicio se fim ausente). */
export function getEventoCutoffDate(evento) {
  if (!evento) return null;
  const fim = evento.dtFim ?? evento.dt_fim;
  const inicio = evento.dtInicio ?? evento.dt_inicio;
  const cutoff = (fim || inicio || '').trim();
  return cutoff || null;
}

export function toDateOnlyKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const mo = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

/** Pós se data de referência >= último dia do evento. Ref: vencimento; se vazio, pagamento. */
export function inferFaseContaPagar({ evento, dtVencimento, dtPagamento }) {
  const cutoff = getEventoCutoffDate(evento);
  if (!cutoff) return null;
  const ref = toDateOnlyKey(dtVencimento) || toDateOnlyKey(dtPagamento);
  if (!ref) return null;
  return ref >= cutoff ? 'pos' : 'pre';
}
