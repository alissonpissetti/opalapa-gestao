import { listContasPagar, summarizeContasPagar } from './financeiro-contas-pagar.js';
import { listArrecadacao } from './arrecadacao.js';
import { listFunilEtapas, perdaStatuses } from './funil.js';
import {
  listFinanceiroResultado,
  findSumarioArrecadacaoLinha,
  findFaturamentoPracaLinha,
  clearSumarioArrecadacaoOverridesNaoEditaveis,
  SUMARIO_ARRECADACAO_DEFS,
} from './financeiro-resultado.js';

const TAXA_PRACA_ALIMENTACAO = 0.2;
import { buildVendasHoraFromLinhas } from './financeiro-vendas-hora.js';
import { buildBebidasFromLinhas } from './financeiro-bebidas.js';

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

function parseMoneyLoose(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw || raw === '—' || raw === '-') return null;
  let s = raw.replace(/\s/g, '').replace(/^R\$/i, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function realizadoFromLinha(linha) {
  if (!linha) return 0;
  return parseMoneyLoose(linha.status) ?? (Number(linha.posEvento) || 0);
}

function buildLinhaSumario({
  chave,
  nome,
  linha,
  previstoCalculado = 0,
  refAnterior = null,
  realizado = null,
  previstoEditavel = true,
  posEvento = false,
}) {
  const previstoManual =
    previstoEditavel && linha?.realizadoPago != null ? Number(linha.realizadoPago) : null;
  const previsto = previstoManual != null ? previstoManual : previstoCalculado;
  return {
    id: chave,
    linhaId: linha?.id ?? null,
    nome,
    refAnterior: refAnterior ?? linha?.preEvento ?? null,
    previsto,
    previstoManual: previstoManual != null,
    previstoCalculado,
    previstoEditavel,
    posEvento,
    fase: posEvento ? 'pos' : null,
    realizado: realizado ?? realizadoFromLinha(linha),
  };
}

function summarizeBonificadoPrefeitura(contas) {
  const ativas = contas.filter((c) => c.status !== 'cancelado' && c.bonificado);
  return {
    refAnterior: null,
    previsto: ativas.reduce((s, c) => s + (Number(c.valorPrevisto) || 0), 0),
    realizado: ativas.reduce((s, c) => s + (Number(c.valorPago) || 0), 0),
  };
}

function buildSumarioArrecadacao({ arrecadacao, perdas, contas, resultadoLinhas }) {
  const entradas = summarizeArrecadacao(arrecadacao, perdas);
  const vendasHora = buildVendasHoraFromLinhas(resultadoLinhas);
  const bebidas = buildBebidasFromLinhas(resultadoLinhas);

  const bonificadoContas = summarizeBonificadoPrefeitura(contas);
  const bonificadoTemContas = bonificadoContas.previsto + bonificadoContas.realizado > 0;

  const linhas = SUMARIO_ARRECADACAO_DEFS.map((def) => {
    const linha = findSumarioArrecadacaoLinha(resultadoLinhas, def.chave);
    const previstoEditavel = def.previstoEditavel !== false;
    const posEvento = def.posEvento === true;
    if (def.chave === 'bonificado-prefeitura') {
      return buildLinhaSumario({
        chave: def.chave,
        nome: def.item,
        linha,
        previstoCalculado: bonificadoTemContas ? bonificadoContas.previsto : 0,
        realizado: bonificadoTemContas ? bonificadoContas.realizado : realizadoFromLinha(linha),
        previstoEditavel,
        posEvento,
      });
    }
    if (def.chave === 'patrocinios-espacos') {
      return buildLinhaSumario({
        chave: def.chave,
        nome: def.item,
        linha,
        previstoCalculado: entradas.total.previsto,
        realizado: entradas.total.realizado,
        previstoEditavel,
        posEvento,
      });
    }
    if (def.chave === 'vendas-hora') {
      return buildLinhaSumario({
        chave: def.chave,
        nome: def.item,
        linha,
        previstoCalculado: vendasHora.totais.previsto,
        realizado: vendasHora.totais.realizado,
        previstoEditavel: false,
        posEvento: true,
      });
    }
    if (def.chave === 'bebidas') {
      return buildLinhaSumario({
        chave: def.chave,
        nome: def.item,
        linha,
        previstoCalculado: bebidas.totais.previstoReceita,
        realizado: bebidas.totais.realizadoReceita,
        previstoEditavel: false,
        posEvento: true,
      });
    }
    return buildLinhaSumario({
      chave: def.chave,
      nome: def.item,
      linha,
      previstoCalculado: 0,
      previstoEditavel,
      posEvento,
    });
  });

  const sumTotais = (items) => {
    const prev = items.reduce((s, l) => s + (Number(l.previsto) || 0), 0);
    const real = items.reduce((s, l) => s + (Number(l.realizado) || 0), 0);
    return { previsto: prev, realizado: real, falta: Math.max(0, prev - real) };
  };

  const linhasPre = linhas.filter((l) => !l.posEvento);
  const linhasPos = linhas.filter((l) => l.posEvento);

  return {
    linhas,
    linhasPre,
    linhasPos,
    totaisPre: sumTotais(linhasPre),
    totaisPos: sumTotais(linhasPos),
    totais: sumTotais(linhas),
  };
}

/** Resultado final:
 *  Previsto = Arrecadação total [+ Taxa alimentação (20%)] − Custo total
 *  Realizado = Arrecadação total + Taxa alimentação (20%) − Custo total
 *  Taxa alimentação = 20% do faturamento da praça de alimentação (campo editável)
 */
export function buildResultadoFinal({
  sumarioArrecadacao,
  totaisContasPagar,
  custosTotais,
  resultadoLinhas,
}) {
  const arrecadacaoPrevisto = Number(sumarioArrecadacao?.totais?.previsto) || 0;
  const arrecadacaoRealizado = Number(sumarioArrecadacao?.totais?.realizado) || 0;

  const custoPrevisto =
    Number(totaisContasPagar?.custoTotal) || Number(custosTotais?.previsto) || 0;
  const custoRealizado =
    Number(totaisContasPagar?.realizado) || Number(custosTotais?.realizado) || 0;

  const faturamentoLinha = findFaturamentoPracaLinha(resultadoLinhas || []);
  const faturamentoPrevisto = Number(faturamentoLinha?.preEvento) || 0;
  const faturamentoRealizado = Number(faturamentoLinha?.posEvento) || 0;

  const taxaPrevisto =
    faturamentoPrevisto > 0 ? faturamentoPrevisto * TAXA_PRACA_ALIMENTACAO : null;
  const taxaRealizado =
    faturamentoRealizado > 0 ? faturamentoRealizado * TAXA_PRACA_ALIMENTACAO : 0;

  const taxaPrevistoValor = taxaPrevisto ?? 0;
  const resultadoFinalPrevisto = arrecadacaoPrevisto + taxaPrevistoValor - custoPrevisto;
  const resultadoFinalRealizado = arrecadacaoRealizado + taxaRealizado - custoRealizado;

  const aporteNecessario = resultadoFinalRealizado < 0 ? Math.abs(resultadoFinalRealizado) : 0;

  const formulaPrevisto =
    taxaPrevisto != null
      ? 'Arrecadação total + Taxa alimentação (20%) − Custo total'
      : 'Arrecadação total − Custo total';

  return {
    formulas: {
      resultadoFinalPrevisto: formulaPrevisto,
      resultadoFinalRealizado: 'Arrecadação total + Taxa alimentação (20%) − Custo total',
      taxaAlimentacao: '20% do faturamento da praça de alimentação',
    },
    faturamentoPraca: {
      previsto: faturamentoPrevisto,
      realizado: faturamentoRealizado,
      linhaId: faturamentoLinha?.id ?? null,
      taxaPct: TAXA_PRACA_ALIMENTACAO,
    },
    linhas: [
      {
        id: 'arrecadacao-total',
        nome: 'RESULTADO FINANCEIRO - Arrecadação Total',
        sinal: '+',
        previsto: arrecadacaoPrevisto,
        realizado: arrecadacaoRealizado,
      },
      {
        id: 'taxa-alimentacao',
        nome: 'RESULTADO FINANCEIRO - Taxa Alimentação',
        sinal: '+',
        previsto: taxaPrevisto,
        realizado: taxaRealizado,
        calculado: true,
      },
      {
        id: 'custo-total',
        nome: 'RESULTADO FINANCEIRO - Custo Total',
        sinal: '-',
        previsto: custoPrevisto,
        realizado: custoRealizado,
      },
      {
        id: 'resultado-final',
        nome: 'RESULTADO FINAL',
        sinal: '=',
        previsto: resultadoFinalPrevisto,
        realizado: resultadoFinalRealizado,
        destaque: true,
      },
      {
        id: 'aporte-necessario',
        nome: 'APORTE NECESSÁRIO',
        previsto: null,
        realizado: aporteNecessario > 0 ? aporteNecessario : null,
        destaque: true,
        aporte: true,
      },
    ],
    aporteNecessario,
    resultadoFinalPrevisto,
    resultadoFinalRealizado,
  };
}

export async function buildFinanceiroPainel(pool, eventoId) {
  const [contas, arrecadacao, etapas, resultadoLinhas] = await Promise.all([
    listContasPagar(pool, eventoId),
    listArrecadacao(pool, eventoId, { scope: 'comercial' }),
    listFunilEtapas(pool, eventoId, { escopo: 'comercial' }),
    listFinanceiroResultado(pool, eventoId),
  ]);

  const perdas = perdaStatuses(etapas);
  await clearSumarioArrecadacaoOverridesNaoEditaveis(pool, eventoId, resultadoLinhas);
  const custos = summarizeContasPagar(contas);
  const entradas = summarizeArrecadacao(arrecadacao, perdas);
  const sumarioArrecadacao = buildSumarioArrecadacao({
    arrecadacao,
    perdas,
    contas,
    resultadoLinhas,
  });
  const vendasHora = buildVendasHoraFromLinhas(resultadoLinhas);
  const bebidas = buildBebidasFromLinhas(resultadoLinhas);

  const bonificado = custos.totaisContasPagar?.bonificado || 0;

  const resultado = {
    saldoPrevisto: entradas.total.previsto - custos.totais.previsto,
    saldoRealizado: entradas.total.realizado - custos.totais.realizado,
    bonificado,
    faltaArrecadar: Math.max(0, custos.totais.previsto - entradas.total.previsto - bonificado),
    faltaReceber: entradas.total.falta,
    gapCaixa: Math.max(0, custos.totais.realizado - entradas.total.realizado),
  };

  const resultadoFinal = buildResultadoFinal({
    sumarioArrecadacao,
    totaisContasPagar: custos.totaisContasPagar,
    custosTotais: custos.totais,
    resultadoLinhas,
  });

  return {
    custos,
    entradas,
    resultado,
    sumarioArrecadacao,
    vendasHora,
    bebidas,
    resultadoFinal,
    porCategoria: custos.porCategoria,
    totaisContasPagar: custos.totaisContasPagar,
    temCustos: contas.filter((c) => c.status !== 'cancelado').length > 0,
    temArrecadacao: entradas.total.quantidade > 0,
    totalItens: contas.filter((c) => c.status !== 'cancelado').length,
  };
}
