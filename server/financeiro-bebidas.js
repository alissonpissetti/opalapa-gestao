import {
  listFinanceiroResultado,
  createFinanceiroLinha,
  updateFinanceiroLinha,
  nextOrdem as nextResultadoOrdem,
} from './financeiro-resultado.js';
import { parseQty } from './financeiro-vendas-hora.js';

const CATEGORIA_BEBIDAS = 'BEBIDAS';

export const BEBIDAS_TEMPLATE = [
  { item: 'Chopp 400ml', previstoQtde: '2321', realizadoQtde: '0', custoUnit: 0, valorUnit: 15 },
  { item: 'Chopp Vinho 400ml', previstoQtde: '172', realizadoQtde: '0', custoUnit: 0, valorUnit: 15 },
  { item: '4 Chopps + 1 Ecocopo 400ml', previstoQtde: '27', realizadoQtde: '0', custoUnit: 0, valorUnit: 60 },
];

function isBebidaLinha(linha) {
  const cat = String(linha.item || '').trim().toUpperCase();
  const nome = String(linha.subItem || '').trim();
  return cat === CATEGORIA_BEBIDAS && nome.length > 0;
}

function linhaToBebida(linha) {
  const previstoQtde = parseQty(linha.previstoQtde);
  const realizadoQtde = parseQty(linha.diaria);
  const custoUnit = Number(linha.orcamento) || 0;
  const valorUnit = Number(linha.valorUnit) || 0;
  const refAnoAnt = previstoQtde * custoUnit;
  const totalCusto = realizadoQtde * custoUnit;
  const previstoReceita = previstoQtde * valorUnit;
  const realizadoReceita = realizadoQtde * valorUnit;
  return {
    id: linha.id,
    categoria: CATEGORIA_BEBIDAS,
    item: String(linha.subItem || '').trim(),
    previstoQtde,
    realizadoQtde,
    custoUnit,
    refAnoAnt,
    totalCusto,
    valorUnit,
    previstoReceita,
    realizadoReceita,
    ordem: linha.ordem,
  };
}

export function buildBebidasFromLinhas(resultadoLinhas) {
  const itens = (resultadoLinhas || []).filter(isBebidaLinha).map(linhaToBebida);
  const totais = {
    refAnoAnt: itens.reduce((s, i) => s + i.refAnoAnt, 0),
    totalCusto: itens.reduce((s, i) => s + i.totalCusto, 0),
    previstoReceita: itens.reduce((s, i) => s + i.previstoReceita, 0),
    realizadoReceita: itens.reduce((s, i) => s + i.realizadoReceita, 0),
  };
  return { itens, totais, temDados: itens.length > 0 };
}

export async function listBebidas(pool, eventoId) {
  const linhas = await listFinanceiroResultado(pool, eventoId);
  return buildBebidasFromLinhas(linhas);
}

async function findBebidaLinha(pool, eventoId, id) {
  const linhas = await listFinanceiroResultado(pool, eventoId);
  const linha = linhas.find((l) => l.id === id);
  if (!linha || !isBebidaLinha(linha)) return null;
  return linha;
}

function normalizePatchInput(raw) {
  const out = {};
  if (raw.previstoQtde != null || raw.previsto_qtde != null) {
    const v = raw.previstoQtde ?? raw.previsto_qtde;
    out.previstoQtde = v === '' || v == null ? '' : String(v).trim();
  }
  if (raw.realizadoQtde != null || raw.realizado_qtde != null) {
    const v = raw.realizadoQtde ?? raw.realizado_qtde;
    out.diaria = v === '' || v == null ? '' : String(v).trim();
  }
  if (raw.valorUnit != null || raw.valor_unit != null) {
    const v = raw.valorUnit ?? raw.valor_unit;
    out.valorUnit = v;
  }
  return out;
}

export async function patchBebida(pool, id, eventoId, raw) {
  const existente = await findBebidaLinha(pool, eventoId, id);
  if (!existente) return null;

  const patch = normalizePatchInput(raw);
  const previstoQtde = patch.previstoQtde != null ? patch.previstoQtde : existente.previstoQtde;
  const realizadoQtde = patch.diaria != null ? patch.diaria : existente.diaria;
  const orcamento = patch.orcamento != null ? patch.orcamento : existente.orcamento;
  const valorUnit = patch.valorUnit != null ? patch.valorUnit : existente.valorUnit;

  const prev = parseQty(previstoQtde);
  const real = parseQty(realizadoQtde);
  const custo = Number(orcamento) || 0;
  const valor = Number(valorUnit) || 0;

  const updated = await updateFinanceiroLinha(pool, id, eventoId, {
    item: existente.item,
    subItem: existente.subItem,
    tipo: existente.tipo,
    previstoQtde,
    diaria: realizadoQtde,
    orcamento: custo,
    valorUnit: valor,
    preEvento: prev * custo,
    valorTotal: real * custo,
    posEvento: prev * valor,
    realizadoPago: real * valor,
  });

  return updated ? linhaToBebida(updated) : null;
}

export async function carregarModeloBebidas(pool, eventoId) {
  const atual = await listBebidas(pool, eventoId);
  if (atual.temDados) {
    return atual;
  }

  let ordemBase = await nextResultadoOrdem(pool, eventoId);
  await createFinanceiroLinha(pool, eventoId, {
    ordem: ordemBase,
    item: 'ARRECADAÇÃO BEBIDAS',
    subItem: 'ITEM',
    tipo: 'secao',
  });
  ordemBase += 1;

  for (let i = 0; i < BEBIDAS_TEMPLATE.length; i += 1) {
    const t = BEBIDAS_TEMPLATE[i];
    const prev = parseQty(t.previstoQtde);
    const real = parseQty(t.realizadoQtde);
    const custo = Number(t.custoUnit) || 0;
    const valor = Number(t.valorUnit) || 0;
    await createFinanceiroLinha(pool, eventoId, {
      ordem: ordemBase + i,
      item: CATEGORIA_BEBIDAS,
      subItem: t.item,
      tipo: 'linha',
      previstoQtde: t.previstoQtde,
      diaria: t.realizadoQtde,
      orcamento: custo,
      valorUnit: valor,
      preEvento: prev * custo,
      valorTotal: real * custo,
      posEvento: prev * valor,
      realizadoPago: real * valor,
    });
  }

  return listBebidas(pool, eventoId);
}
