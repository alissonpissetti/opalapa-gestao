import { listContasPagar, summarizeContasPagar } from './financeiro-contas-pagar.js';
import { listArrecadacao } from './arrecadacao.js';
import { listFunilEtapas, perdaStatuses } from './funil.js';

function summarizeTipo(list) {
  const previsto = list.reduce((s, i) => s + (Number(i.valorTotal) || 0), 0);
  const realizado = list.reduce((s, i) => s + (Number(i.valorPago) || 0), 0);
  return {
    previsto,
    realizado,
    falta: Math.max(0, previsto - realizado),
    quantidade: list.length,
  };
}

function summarizeArrecadacao(items, perdas) {
  const active = items.filter((i) => !perdas.has(i.status));
  const espacos = summarizeTipo(active.filter((i) => i.tipo === 'espaco'));
  const patrocinios = summarizeTipo(active.filter((i) => i.tipo === 'patrocinio'));
  const totalPrevisto = espacos.previsto + patrocinios.previsto;
  const totalRealizado = espacos.realizado + patrocinios.realizado;

  return {
    espacos,
    patrocinios,
    total: {
      previsto: totalPrevisto,
      realizado: totalRealizado,
      falta: Math.max(0, totalPrevisto - totalRealizado),
      quantidade: espacos.quantidade + patrocinios.quantidade,
    },
  };
}

export async function buildFinanceiroPainel(pool, eventoId) {
  const [contas, arrecadacao, etapas] = await Promise.all([
    listContasPagar(pool, eventoId),
    listArrecadacao(pool, eventoId, { scope: 'comercial' }),
    listFunilEtapas(pool, eventoId, { escopo: 'comercial' }),
  ]);

  const perdas = perdaStatuses(etapas);
  const custos = summarizeContasPagar(contas);
  const entradas = summarizeArrecadacao(arrecadacao, perdas);

  const resultado = {
    saldoPrevisto: entradas.total.previsto - custos.totais.previsto,
    saldoRealizado: entradas.total.realizado - custos.totais.realizado,
    faltaArrecadar: Math.max(0, custos.totais.previsto - entradas.total.previsto),
    faltaReceber: entradas.total.falta,
    gapCaixa: Math.max(0, custos.totais.realizado - entradas.total.realizado),
  };

  return {
    custos,
    entradas,
    resultado,
    temCustos: contas.filter((c) => c.status !== 'cancelado').length > 0,
    temArrecadacao: entradas.total.quantidade > 0,
    totalItens: contas.filter((c) => c.status !== 'cancelado').length,
  };
}
