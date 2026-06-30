import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_CSV_PATH = path.join(__dirname, 'data', 'financeiro-resultado.csv');

const TIPOS = ['categoria', 'linha', 'secao', 'resumo'];

export const SUMARIO_ARRECADACAO_DEFS = [
  { chave: 'reserva-pre', item: 'RESERVA PRÉ - SALDO', pattern: /^RESERVA PRÉ\s*-/i },
  {
    chave: 'bonificado-prefeitura',
    item: 'ARRECADAÇÃO BONIFICADO - PREFEITURA',
    pattern: /^ARRECADAÇÃO BONIFICADO/i,
    previstoEditavel: false,
  },
  {
    chave: 'ingressos-digitais',
    item: 'ARRECADAÇÃO INGRESSOS DIGITAIS',
    pattern: /^ARRECADAÇÃO INGRESSOS DIGITAIS/i,
  },
  {
    chave: 'patrocinios-espacos',
    item: 'ARRECADAÇÃO PATROCÍNIOS E ESPAÇOS',
    pattern: /^ARRECADAÇÃO PATROCÍNIOS E ESPAÇOS/i,
    previstoEditavel: false,
  },
  { chave: 'produtos', item: 'ARRECADAÇÃO PRODUTOS', pattern: /^ARRECADAÇÃO PRODUTOS/i },
  {
    chave: 'pre-alimentacao',
    item: 'ARRECADAÇÃO PRÉ ALIMENTAÇÃO',
    pattern: /^ARRECADAÇÃO PRÉ ALIMENTAÇÃO/i,
  },
  {
    chave: 'vendas-hora',
    item: 'ARRECADAÇÃO PRODUTOS NA HORA',
    pattern: /^ARRECADAÇÃO PRODUTOS NA HORA|^ARRECADAÇÃO VENDAS NA HORA|^VENDAS NA HORA/i,
    previstoEditavel: false,
    posEvento: true,
  },
  {
    chave: 'bebidas',
    item: 'ARRECADAÇÃO BEBIDAS NA HORA',
    pattern: /^ARRECADAÇÃO BEBIDAS(?:\s+NA\s+HORA)?/i,
    previstoEditavel: false,
    posEvento: true,
  },
];

export function findSumarioArrecadacaoLinha(linhas, chave) {
  const def = SUMARIO_ARRECADACAO_DEFS.find((d) => d.chave === chave);
  if (!def) return null;
  return linhas.find((l) => def.pattern.test(String(l.item || '').trim())) || null;
}

export const FATURAMENTO_PRACA_ALIMENTACAO_ITEM = 'FATURAMENTO PRAÇA ALIMENTAÇÃO';

export function findFaturamentoPracaLinha(linhas) {
  return (
    linhas.find((l) =>
      /^FATURAMENTO\s+PRA[CÇ]A\s+ALIMENTA[CÇ][AÃ]O/i.test(String(l.item || '').trim()),
    ) || null
  );
}

export async function patchFaturamentoPracaAlimentacao(pool, eventoId, { previsto, realizado } = {}) {
  if (previsto === undefined && realizado === undefined) {
    throw Object.assign(new Error('Informe o faturamento previsto ou realizado'), { status: 400 });
  }

  const linhas = await listFinanceiroResultado(pool, eventoId);
  const existente = findFaturamentoPracaLinha(linhas);

  let preVal = existente?.preEvento ?? null;
  let posVal = existente?.posEvento ?? null;

  if (previsto !== undefined) {
    if (previsto == null || previsto === '') {
      preVal = null;
    } else {
      const v = moneyToDb(previsto);
      if (v == null) {
        throw Object.assign(new Error('Informe um faturamento previsto válido'), { status: 400 });
      }
      preVal = v;
    }
  }
  if (realizado !== undefined) {
    if (realizado == null || realizado === '') {
      posVal = null;
    } else {
      const v = moneyToDb(realizado);
      if (v == null) {
        throw Object.assign(new Error('Informe um faturamento realizado válido'), { status: 400 });
      }
      posVal = v;
    }
  }

  if (existente) {
    await pool.query(
      `UPDATE financeiro_resultado_linhas
       SET pre_evento = ?, pos_evento = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND evento_id = ?`,
      [preVal, posVal, existente.id, eventoId],
    );
    const [rows] = await pool.query(
      'SELECT id, evento_id, ordem, tipo, item, orcamento_categoria, sub_item, previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total, pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso FROM financeiro_resultado_linhas WHERE id = ?',
      [existente.id],
    );
    const linha = rows[0] ? rowToLinha(rows[0]) : null;
    return {
      previsto: linha?.preEvento ?? 0,
      realizado: linha?.posEvento ?? 0,
      linha,
    };
  }

  const linha = await createFinanceiroLinha(pool, eventoId, {
    item: FATURAMENTO_PRACA_ALIMENTACAO_ITEM,
    tipo: 'resumo',
    preEvento: preVal,
    posEvento: posVal,
  });
  return {
    previsto: linha?.preEvento ?? 0,
    realizado: linha?.posEvento ?? 0,
    linha,
  };
}

function parseMoneyBr(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === '—' || raw === '-') return null;
  let negative = false;
  let s = raw.replace(/\s/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/^R\$/i, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function moneyToDb(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  return parseMoneyBr(raw);
}

function linhaContentKey(row) {
  return [
    row.ordem,
    row.tipo,
    row.item,
    row.orcamento_categoria,
    row.sub_item,
    row.previsto_qtde,
    row.diaria,
    row.orcamento,
    row.valor_unit,
    row.valor_bonificado,
    row.valor_total,
    row.pre_evento,
    row.pos_evento,
    row.realizado_pago,
    row.status,
    row.dt_prevista,
    row.dt_realiz,
    row.quem,
    row.reembolso,
  ].join('\x1f');
}

async function removeDuplicateFinanceiroLinhas(pool, eventoId, rows) {
  const byOrdem = new Map();
  for (const row of rows) {
    const ordem = Number(row.ordem);
    if (!byOrdem.has(ordem)) byOrdem.set(ordem, []);
    byOrdem.get(ordem).push(row);
  }

  const idsToDelete = [];
  for (const group of byOrdem.values()) {
    if (group.length < 2) continue;
    const byKey = new Map();
    for (const row of group) {
      const key = linhaContentKey(row);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
    for (const dupes of byKey.values()) {
      if (dupes.length < 2) continue;
      dupes.sort((a, b) => a.id - b.id);
      for (let i = 1; i < dupes.length; i += 1) idsToDelete.push(dupes[i].id);
    }
  }

  if (!idsToDelete.length) return false;
  await pool.query('DELETE FROM financeiro_resultado_linhas WHERE evento_id = ? AND id IN (?)', [
    eventoId,
    idsToDelete,
  ]);
  return true;
}

function rowToLinha(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    ordem: Number(row.ordem),
    tipo: row.tipo,
    item: row.item || '',
    orcamentoCategoria: row.orcamento_categoria != null ? Number(row.orcamento_categoria) : null,
    subItem: row.sub_item || '',
    previstoQtde: row.previsto_qtde || '',
    diaria: row.diaria || '',
    orcamento: row.orcamento != null ? Number(row.orcamento) : null,
    valorUnit: row.valor_unit != null ? Number(row.valor_unit) : null,
    valorBonificado: row.valor_bonificado != null ? Number(row.valor_bonificado) : null,
    valorTotal: row.valor_total != null ? Number(row.valor_total) : null,
    preEvento: row.pre_evento != null ? Number(row.pre_evento) : null,
    posEvento: row.pos_evento != null ? Number(row.pos_evento) : null,
    realizadoPago: row.realizado_pago != null ? Number(row.realizado_pago) : null,
    status: row.status || '',
    dtPrevista: row.dt_prevista || '',
    dtRealiz: row.dt_realiz || '',
    quem: row.quem || '',
    reembolso: row.reembolso != null ? Number(row.reembolso) : null,
  };
}

function inferTipo(item, orcamentoCategoria, subItem) {
  const label = String(item || '').trim();
  if (!label) return 'linha';
  const upper = label.toUpperCase();
  if (
    /^(CUSTO|TOTAL|SUBTOTAL|SALDO|APORTE|RESULTADO|FALTANTE|ANÁLISE|ARRECADAÇÃO)/i.test(label) ||
    label.startsWith('Custo ') ||
    label.startsWith('Total ') ||
    label === 'TOTAL' ||
    /^\d+%$/.test(label)
  ) {
    return 'resumo';
  }
  if (
    upper === label &&
    label.length > 8 &&
    (label.includes('ARRECADAÇÃO') ||
      label.includes('VENDAS') ||
      label.includes('BEBIDAS') ||
      label.includes('INGRESSO') ||
      label === 'ITEM A VENDA')
  ) {
    return 'secao';
  }
  if (orcamentoCategoria != null && !subItem) return 'categoria';
  if (label && orcamentoCategoria != null) return 'categoria';
  if (label && !subItem && orcamentoCategoria == null && upper === label && label.length > 3) {
    return 'secao';
  }
  if (label && !subItem) return 'categoria';
  return 'linha';
}

function normalizeLinhaInput(raw, { forInsert = false } = {}) {
  const item = String(raw.item ?? '').trim();
  const subItem = String(raw.subItem ?? raw.sub_item ?? '').trim();
  const orcamentoCategoria = moneyToDb(raw.orcamentoCategoria ?? raw.orcamento_categoria);

  let tipo = String(raw.tipo || '').toLowerCase();
  if (!TIPOS.includes(tipo)) {
    tipo = inferTipo(item, orcamentoCategoria, subItem);
  }

  if (forInsert && !item && !subItem) {
    throw Object.assign(new Error('Informe o item ou sub-item'), { status: 400 });
  }

  return {
    tipo,
    item,
    orcamentoCategoria,
    subItem,
    previstoQtde: String(raw.previstoQtde ?? raw.previsto_qtde ?? '').trim(),
    diaria: String(raw.diaria ?? '').trim(),
    orcamento: moneyToDb(raw.orcamento),
    valorUnit: moneyToDb(raw.valorUnit ?? raw.valor_unit),
    valorBonificado: moneyToDb(raw.valorBonificado ?? raw.valor_bonificado),
    valorTotal: moneyToDb(raw.valorTotal ?? raw.valor_total),
    preEvento: moneyToDb(raw.preEvento ?? raw.pre_evento),
    posEvento: moneyToDb(raw.posEvento ?? raw.pos_evento),
    realizadoPago: moneyToDb(raw.realizadoPago ?? raw.realizado_pago),
    status: String(raw.status ?? '').trim(),
    dtPrevista: String(raw.dtPrevista ?? raw.dt_prevista ?? '').trim(),
    dtRealiz: String(raw.dtRealiz ?? raw.dt_realiz ?? '').trim(),
    quem: String(raw.quem ?? '').trim(),
    reembolso: moneyToDb(raw.reembolso),
  };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseTemplateCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const item = (cols[0] || '').trim();
    const subItem = (cols[2] || '').trim();
    if (!item && !subItem && cols.slice(3, 17).every((c) => !(c || '').trim())) continue;

    const orcamentoCategoria = parseMoneyBr(cols[1]);
    const data = {
      item,
      orcamentoCategoria,
      subItem,
      previstoQtde: (cols[3] || '').trim(),
      diaria: (cols[4] || '').trim(),
      orcamento: parseMoneyBr(cols[5]),
      valorUnit: parseMoneyBr(cols[6]),
      valorBonificado: parseMoneyBr(cols[7]),
      valorTotal: parseMoneyBr(cols[8]),
      preEvento: parseMoneyBr(cols[9]),
      posEvento: parseMoneyBr(cols[10]),
      realizadoPago: parseMoneyBr(cols[11]),
      status: (cols[12] || '').trim(),
      dtPrevista: (cols[13] || '').trim(),
      dtRealiz: (cols[14] || '').trim(),
      quem: (cols[15] || '').trim(),
      reembolso: parseMoneyBr(cols[16]),
    };
    data.tipo = inferTipo(data.item, data.orcamentoCategoria, data.subItem);
    rows.push(data);
  }
  return rows;
}

const LINHA_INSERT = `
  INSERT INTO financeiro_resultado_linhas (
    evento_id, ordem, tipo, item, orcamento_categoria, sub_item,
    previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total,
    pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
`;

function linhaParams(eventoId, ordem, data) {
  return [
    eventoId,
    ordem,
    data.tipo,
    data.item,
    data.orcamentoCategoria,
    data.subItem,
    data.previstoQtde || null,
    data.diaria || null,
    data.orcamento,
    data.valorUnit,
    data.valorBonificado,
    data.valorTotal,
    data.preEvento,
    data.posEvento,
    data.realizadoPago,
    data.status || null,
    data.dtPrevista || null,
    data.dtRealiz || null,
    data.quem || null,
    data.reembolso,
  ];
}

export async function migrateFinanceiroResultado(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financeiro_resultado_linhas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      tipo ENUM('categoria', 'linha', 'secao', 'resumo') NOT NULL DEFAULT 'linha',
      item VARCHAR(200) NOT NULL DEFAULT '',
      orcamento_categoria DECIMAL(14,2) NULL,
      sub_item VARCHAR(200) NOT NULL DEFAULT '',
      previsto_qtde VARCHAR(40) NULL,
      diaria VARCHAR(40) NULL,
      orcamento DECIMAL(14,2) NULL,
      valor_unit DECIMAL(14,2) NULL,
      valor_bonificado DECIMAL(14,2) NULL,
      valor_total DECIMAL(14,2) NULL,
      pre_evento DECIMAL(14,2) NULL,
      pos_evento DECIMAL(14,2) NULL,
      realizado_pago DECIMAL(14,2) NULL,
      status VARCHAR(80) NULL,
      dt_prevista VARCHAR(40) NULL,
      dt_realiz VARCHAR(40) NULL,
      quem VARCHAR(120) NULL,
      reembolso DECIMAL(14,2) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_fin_resultado_evento (evento_id),
      INDEX idx_fin_resultado_ordem (evento_id, ordem),
      CONSTRAINT fk_fin_resultado_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

const LINHA_SELECT = `SELECT id, evento_id, ordem, tipo, item, orcamento_categoria, sub_item,
            previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total,
            pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso
     FROM financeiro_resultado_linhas
     WHERE evento_id = ?
     ORDER BY ordem ASC, id ASC`;

export async function listFinanceiroResultado(pool, eventoId) {
  let [rows] = await pool.query(LINHA_SELECT, [eventoId]);
  if (await removeDuplicateFinanceiroLinhas(pool, eventoId, rows)) {
    [rows] = await pool.query(LINHA_SELECT, [eventoId]);
  }
  return rows.map(rowToLinha);
}

export async function nextOrdem(pool, eventoId) {
  const [rows] = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem FROM financeiro_resultado_linhas WHERE evento_id = ?',
    [eventoId],
  );
  return Number(rows[0]?.next_ordem) || 0;
}

export async function createFinanceiroLinha(pool, eventoId, raw) {
  const data = normalizeLinhaInput(raw, { forInsert: true });
  const ordem = raw.ordem != null ? Number(raw.ordem) : await nextOrdem(pool, eventoId);
  const [result] = await pool.query(LINHA_INSERT, linhaParams(eventoId, ordem, data));
  const [rows] = await pool.query(
    'SELECT id, evento_id, ordem, tipo, item, orcamento_categoria, sub_item, previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total, pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso FROM financeiro_resultado_linhas WHERE id = ?',
    [result.insertId],
  );
  return rows[0] ? rowToLinha(rows[0]) : null;
}

export async function updateFinanceiroLinha(pool, id, eventoId, raw) {
  const data = normalizeLinhaInput(raw);
  const [result] = await pool.query(
    `UPDATE financeiro_resultado_linhas SET
       tipo = ?, item = ?, orcamento_categoria = ?, sub_item = ?,
       previsto_qtde = ?, diaria = ?, orcamento = ?, valor_unit = ?, valor_bonificado = ?, valor_total = ?,
       pre_evento = ?, pos_evento = ?, realizado_pago = ?, status = ?, dt_prevista = ?, dt_realiz = ?, quem = ?, reembolso = ?,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      data.tipo,
      data.item,
      data.orcamentoCategoria,
      data.subItem,
      data.previstoQtde || null,
      data.diaria || null,
      data.orcamento,
      data.valorUnit,
      data.valorBonificado,
      data.valorTotal,
      data.preEvento,
      data.posEvento,
      data.realizadoPago,
      data.status || null,
      data.dtPrevista || null,
      data.dtRealiz || null,
      data.quem || null,
      data.reembolso,
      id,
      eventoId,
    ],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(
    'SELECT id, evento_id, ordem, tipo, item, orcamento_categoria, sub_item, previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total, pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso FROM financeiro_resultado_linhas WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return rows[0] ? rowToLinha(rows[0]) : null;
}

export async function deleteFinanceiroLinha(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM financeiro_resultado_linhas WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function clearSumarioArrecadacaoOverridesNaoEditaveis(pool, eventoId, linhas) {
  const rows = linhas ?? (await listFinanceiroResultado(pool, eventoId));
  for (const def of SUMARIO_ARRECADACAO_DEFS) {
    if (def.previstoEditavel !== false) continue;
    const linha = findSumarioArrecadacaoLinha(rows, def.chave);
    if (linha?.realizadoPago == null) continue;
    await pool.query(
      `UPDATE financeiro_resultado_linhas
       SET realizado_pago = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND evento_id = ?`,
      [linha.id, eventoId],
    );
    linha.realizadoPago = null;
  }
}

export async function patchSumarioArrecadacaoPrevisto(pool, eventoId, chave, previsto) {
  const def = SUMARIO_ARRECADACAO_DEFS.find((d) => d.chave === chave);
  if (!def) {
    throw Object.assign(new Error('Categoria do sumário inválida'), { status: 400 });
  }
  if (def.previstoEditavel === false) {
    throw Object.assign(
      new Error('O previsto desta categoria é calculado automaticamente e não pode ser editado'),
      { status: 403 },
    );
  }

  const previstoVal = moneyToDb(previsto);
  if (previstoVal == null) {
    throw Object.assign(new Error('Informe um valor previsto válido'), { status: 400 });
  }

  const linhas = await listFinanceiroResultado(pool, eventoId);
  const existente = findSumarioArrecadacaoLinha(linhas, chave);

  if (existente) {
    await pool.query(
      `UPDATE financeiro_resultado_linhas
       SET realizado_pago = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND evento_id = ?`,
      [previstoVal, existente.id, eventoId],
    );
    const [rows] = await pool.query(
      'SELECT id, evento_id, ordem, tipo, item, orcamento_categoria, sub_item, previsto_qtde, diaria, orcamento, valor_unit, valor_bonificado, valor_total, pre_evento, pos_evento, realizado_pago, status, dt_prevista, dt_realiz, quem, reembolso FROM financeiro_resultado_linhas WHERE id = ?',
      [existente.id],
    );
    return { chave, previsto: previstoVal, linha: rows[0] ? rowToLinha(rows[0]) : null };
  }

  const linha = await createFinanceiroLinha(pool, eventoId, {
    item: def.item,
    tipo: 'resumo',
    realizadoPago: previstoVal,
  });
  return { chave, previsto: previstoVal, linha };
}

export async function clearFinanceiroResultado(pool, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM financeiro_resultado_linhas WHERE evento_id = ?',
    [eventoId],
  );
  return result.affectedRows;
}

export async function carregarModeloFinanceiroResultado(pool, eventoId, { substituir = false } = {}) {
  let csvText = '';
  try {
    csvText = fs.readFileSync(TEMPLATE_CSV_PATH, 'utf8');
  } catch {
    throw Object.assign(new Error('Modelo financeiro não encontrado no servidor'), { status: 500 });
  }

  const templateRows = parseTemplateCsv(csvText);
  if (!templateRows.length) {
    throw Object.assign(new Error('Modelo financeiro vazio'), { status: 500 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [eventoRows] = await conn.query('SELECT id FROM eventos WHERE id = ? FOR UPDATE', [eventoId]);
    if (!eventoRows.length) {
      throw Object.assign(new Error('Evento não encontrado'), { status: 404 });
    }

    const [existing] = await conn.query(
      'SELECT COUNT(*) AS n FROM financeiro_resultado_linhas WHERE evento_id = ?',
      [eventoId],
    );
    const count = Number(existing[0]?.n || 0);
    if (count > 0 && !substituir) {
      throw Object.assign(new Error('Já existem linhas neste evento. Confirme para substituir.'), {
        status: 409,
      });
    }

    if (substituir) {
      await conn.query('DELETE FROM financeiro_resultado_linhas WHERE evento_id = ?', [eventoId]);
    }
    for (let i = 0; i < templateRows.length; i += 1) {
      await conn.query(LINHA_INSERT, linhaParams(eventoId, i, templateRows[i]));
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return listFinanceiroResultado(pool, eventoId);
}
