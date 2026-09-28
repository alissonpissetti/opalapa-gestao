import { inferIngressosPadraoFromNome } from '../arrecadacao-produtos.js';

function toInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

export function ingressosPadraoDoPlano(row) {
  const fromPlano = toInt(row?.produto_ingressos_padrao);
  if (fromPlano != null) return fromPlano;
  return inferIngressosPadraoFromNome(row?.produto_nome);
}

export function ingressosEfetivosDoLead(row) {
  const padrao = ingressosPadraoDoPlano(row);
  const solicitados = toInt(row?.ingressos_solicitados);
  if (solicitados != null) return solicitados;
  const legacy = toInt(row?.ingressos_cortesia);
  if (legacy != null && legacy > 0) return legacy;
  return padrao;
}

export function ingressosTemplateValues(row) {
  const padrao = ingressosPadraoDoPlano(row);
  const efetivos = ingressosEfetivosDoLead(row);
  const text = String(efetivos);
  return {
    ingressos: text,
    ingressos_padrao: String(padrao),
    ingresso: text,
    qtd_ingressos: text,
    numero_ingressos: text,
  };
}
