import {
  listFinanceiroResultado,
  createFinanceiroLinha,
  updateFinanceiroLinha,
  nextOrdem as nextResultadoOrdem,
} from './financeiro-resultado.js';

const CATEGORIAS_VENDA = new Set(['ITEM A VENDA', 'INGRESSO']);

/** Nomes de itens no painel (vendas na hora), só para eventos listados — chave = nome do modelo. */
export const VENDAS_HORA_ITEM_LABELS_POR_EVENTO = {
  1: {
    'Ecocopo 2024': 'Ecocopo anos anteriores',
    'Ecocopo Oficial Opalapa 2025': 'Ecocopo 2026',
  },
};

function normalizeVendaItemNome(nome) {
  return String(nome || '').trim().toLowerCase();
}

function vendasHoraItemOverrides(eventoId) {
  return VENDAS_HORA_ITEM_LABELS_POR_EVENTO[Number(eventoId)] ?? null;
}

export function vendasHoraItemLabelForEvento(eventoId, templateItem) {
  const overrides = vendasHoraItemOverrides(eventoId);
  if (overrides && overrides[templateItem]) return overrides[templateItem];
  return templateItem;
}

export async function ensureVendasHoraEventItemLabels(pool, eventoId, linhasIn = null) {
  const overrides = vendasHoraItemOverrides(eventoId);
  if (!overrides) {
    return linhasIn ?? listFinanceiroResultado(pool, eventoId);
  }

  let linhas = linhasIn ?? (await listFinanceiroResultado(pool, eventoId));
  let changed = false;

  for (const [nomeModelo, nomeEvento] of Object.entries(overrides)) {
    const destinoNorm = normalizeVendaItemNome(nomeEvento);
    const origemNorm = normalizeVendaItemNome(nomeModelo);
    const jaTemDestino = linhas.some(
      (l) => isVendaHoraLinha(l) && normalizeVendaItemNome(l.subItem) === destinoNorm,
    );
    if (jaTemDestino) continue;

    const legado = linhas.find(
      (l) => isVendaHoraLinha(l) && normalizeVendaItemNome(l.subItem) === origemNorm,
    );
    if (!legado) continue;

    await updateFinanceiroLinha(pool, legado.id, eventoId, {
      item: legado.item,
      subItem: nomeEvento,
      tipo: legado.tipo,
      previstoQtde: legado.previstoQtde,
      diaria: legado.diaria,
      orcamento: legado.orcamento,
      valorUnit: legado.valorUnit,
      valorBonificado: legado.valorBonificado,
      valorTotal: legado.valorTotal,
      preEvento: legado.preEvento,
      posEvento: legado.posEvento,
      realizadoPago: legado.realizadoPago,
    });
    changed = true;
  }

  if (!changed) return linhas;
  return listFinanceiroResultado(pool, eventoId);
}

export const VENDAS_HORA_TEMPLATE = [
  { categoria: 'ITEM A VENDA', item: 'Camiseta Promo', previstoQtde: '0', realizadoQtde: '0', valorVenda: 50 },
  { categoria: 'ITEM A VENDA', item: 'Camiseta Dryfit 2025', previstoQtde: '0', realizadoQtde: '0', valorVenda: 50 },
  { categoria: 'ITEM A VENDA', item: 'Camiseta Premium Opalapa', previstoQtde: '0', realizadoQtde: '0', valorVenda: 90 },
  { categoria: 'ITEM A VENDA', item: 'Boné Trucker Opalapa', previstoQtde: '0', realizadoQtde: '0', valorVenda: 70 },
  { categoria: 'ITEM A VENDA', item: 'Ecocopo 2024', previstoQtde: '0', realizadoQtde: '0', valorVenda: 5 },
  { categoria: 'ITEM A VENDA', item: 'Ecocopo Oficial Opalapa 2025', previstoQtde: '0', realizadoQtde: '0', valorVenda: 10 },
  { categoria: 'ITEM A VENDA', item: 'Adesivo Eu Fui', previstoQtde: '0', realizadoQtde: '0', valorVenda: 5 },
  { categoria: 'INGRESSO', item: 'Diferença SEXTA', previstoQtde: '0', realizadoQtde: '0', valorVenda: 40 },
  { categoria: 'INGRESSO', item: 'ANTECIPADO SEXTA', previstoQtde: '0', realizadoQtde: '0', valorVenda: 140 },
  { categoria: 'INGRESSO', item: 'NORMAL', previstoQtde: '0', realizadoQtde: '0', valorVenda: 100 },
  { categoria: 'INGRESSO', item: 'Somente domingo', previstoQtde: '0', realizadoQtde: '0', valorVenda: 80 },
  { categoria: 'ITEM A VENDA', item: 'Motor L6', previstoQtde: '0', realizadoQtde: '0', valorVenda: 549 },
  {
    categoria: 'ITEM A VENDA',
    item: 'Período 5 min Stock Car Experience',
    previstoQtde: '0',
    realizadoQtde: '0',
    valorVenda: 20,
  },
];

export function parseQty(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function isVendaHoraLinha(linha) {
  const cat = String(linha.item || '').trim().toUpperCase();
  const nome = String(linha.subItem || '').trim();
  return CATEGORIAS_VENDA.has(cat) && nome.length > 0;
}

function vendaHoraLinhaKey(linha) {
  const cat = String(linha.item || '').trim().toUpperCase();
  return `${cat}|${normalizeVendaItemNome(linha.subItem)}`;
}

function vendaHoraTemplateKey(eventoId, template) {
  const cat = String(template.categoria || '').trim().toUpperCase();
  const nome = vendasHoraItemLabelForEvento(eventoId, template.item);
  return `${cat}|${normalizeVendaItemNome(nome)}`;
}

async function createVendaHoraLinhaFromTemplate(pool, eventoId, ordem, template) {
  const prev = parseQty(template.previstoQtde);
  const real = parseQty(template.realizadoQtde);
  const valor = Number(template.valorVenda) || 0;
  await createFinanceiroLinha(pool, eventoId, {
    ordem,
    item: template.categoria,
    subItem: vendasHoraItemLabelForEvento(eventoId, template.item),
    tipo: 'linha',
    previstoQtde: template.previstoQtde,
    diaria: template.realizadoQtde,
    valorUnit: template.valorVenda,
    posEvento: prev * valor,
    realizadoPago: real * valor,
  });
}

export async function ensureVendasHoraTemplateItens(pool, eventoId) {
  const linhas = await listFinanceiroResultado(pool, eventoId);
  const vendaLinhas = linhas.filter(isVendaHoraLinha);
  if (vendaLinhas.length === 0) return linhas;

  const chavesExistentes = new Set(vendaLinhas.map(vendaHoraLinhaKey));
  const faltantes = VENDAS_HORA_TEMPLATE.filter(
    (t) => !chavesExistentes.has(vendaHoraTemplateKey(eventoId, t)),
  );
  if (faltantes.length === 0) return linhas;

  const ordemBase = Math.max(...vendaLinhas.map((l) => Number(l.ordem) || 0), 0) + 1;
  for (let i = 0; i < faltantes.length; i += 1) {
    await createVendaHoraLinhaFromTemplate(pool, eventoId, ordemBase + i, faltantes[i]);
  }
  return listFinanceiroResultado(pool, eventoId);
}

function linhaToVendaHora(linha) {
  const previstoQtde = parseQty(linha.previstoQtde);
  const realizadoQtde = parseQty(linha.diaria);
  const valorVenda = Number(linha.valorUnit) || 0;
  const previstoTotal = previstoQtde * valorVenda;
  const realizadoTotal = realizadoQtde * valorVenda;
  return {
    id: linha.id,
    categoria: String(linha.item || '').trim(),
    item: String(linha.subItem || '').trim(),
    previstoQtde,
    realizadoQtde,
    valorVenda,
    previstoTotal,
    realizadoTotal,
    ordem: linha.ordem,
  };
}

export function buildVendasHoraFromLinhas(resultadoLinhas) {
  const itens = (resultadoLinhas || []).filter(isVendaHoraLinha).map(linhaToVendaHora);
  const totais = {
    previsto: itens.reduce((s, i) => s + i.previstoTotal, 0),
    realizado: itens.reduce((s, i) => s + i.realizadoTotal, 0),
  };
  return { itens, totais, temDados: itens.length > 0 };
}

export async function listVendasHora(pool, eventoId) {
  const linhasTemplate = await ensureVendasHoraTemplateItens(pool, eventoId);
  const linhas = await ensureVendasHoraEventItemLabels(pool, eventoId, linhasTemplate);
  return buildVendasHoraFromLinhas(linhas);
}

async function findVendaHoraLinha(pool, eventoId, id) {
  const linhas = await listFinanceiroResultado(pool, eventoId);
  const linha = linhas.find((l) => l.id === id);
  if (!linha || !isVendaHoraLinha(linha)) return null;
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
  if (raw.valorVenda != null || raw.valor_venda != null || raw.valorUnit != null || raw.valor_unit != null) {
    const v = raw.valorVenda ?? raw.valor_venda ?? raw.valorUnit ?? raw.valor_unit;
    out.valorUnit = v;
  }
  return out;
}

export async function patchVendaHora(pool, id, eventoId, raw) {
  const existente = await findVendaHoraLinha(pool, eventoId, id);
  if (!existente) return null;

  const patch = normalizePatchInput(raw);
  const previstoQtde = patch.previstoQtde != null ? patch.previstoQtde : existente.previstoQtde;
  const realizadoQtde = patch.diaria != null ? patch.diaria : existente.diaria;
  const valorUnit =
    patch.valorUnit != null
      ? patch.valorUnit
      : existente.valorUnit;

  const prev = parseQty(previstoQtde);
  const real = parseQty(realizadoQtde);
  const valor = Number(valorUnit) || 0;

  const updated = await updateFinanceiroLinha(pool, id, eventoId, {
    item: existente.item,
    subItem: existente.subItem,
    tipo: existente.tipo,
    previstoQtde,
    diaria: realizadoQtde,
    valorUnit,
    posEvento: prev * valor,
    realizadoPago: real * valor,
  });

  return updated ? linhaToVendaHora(updated) : null;
}

export async function carregarModeloVendasHora(pool, eventoId) {
  const atual = await listVendasHora(pool, eventoId);
  if (atual.temDados) {
    return atual;
  }

  let ordemBase = await nextResultadoOrdem(pool, eventoId);
  const vendasSecaoOrdem = ordemBase;
  await createFinanceiroLinha(pool, eventoId, {
    ordem: vendasSecaoOrdem,
    item: 'VENDAS NA HORA',
    subItem: 'ITEM',
    tipo: 'secao',
  });
  ordemBase += 1;

  for (let i = 0; i < VENDAS_HORA_TEMPLATE.length; i += 1) {
    await createVendaHoraLinhaFromTemplate(pool, eventoId, ordemBase + i, VENDAS_HORA_TEMPLATE[i]);
  }

  return listVendasHora(pool, eventoId);
}
