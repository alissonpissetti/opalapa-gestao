import { CAMISETA_TAMANHOS } from './arrecadacao-produtos.js';
import { listProducaoEntregas } from './producao-entregas.js';

export const MATERIAL_CATEGORIAS = [
  { key: 'camiseta', label: 'Camiseta' },
  { key: 'lona', label: 'Lona / banner' },
  { key: 'adesivo', label: 'Adesivo' },
  { key: 'impressao_3d', label: 'Impressão 3D' },
  { key: 'textil', label: 'Têxtil / costura' },
  { key: 'sinalizacao', label: 'Sinalização' },
  { key: 'brinde', label: 'Brinde / kit' },
  { key: 'outro', label: 'Outro' },
];

export const MATERIAL_UNIDADES = ['un', 'm²', 'm', 'par', 'kit', 'rolo', 'folha'];

export const LOTE_STATUS_OPCOES = [
  { key: 'em_criacao', label: 'Em criação' },
  { key: 'enviado_orcamento', label: 'Enviado para orçamento' },
  { key: 'orcamento_aprovado', label: 'Orçamento aprovado' },
  { key: 'em_producao', label: 'Em produção' },
  { key: 'em_entrega', label: 'Em entrega' },
];

const LOTE_STATUS_KEYS = new Set(LOTE_STATUS_OPCOES.map((o) => o.key));
const DEFAULT_LOTE_STATUS = 'em_criacao';

const CATEGORIA_KEYS = new Set(MATERIAL_CATEGORIAS.map((c) => c.key));
const UNIDADE_SET = new Set(MATERIAL_UNIDADES);

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return { ...fallback };
  if (typeof value === 'object' && !Array.isArray(value)) return { ...fallback, ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)
        ? { ...fallback, ...parsed }
        : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }
  return { ...fallback };
}

function normalizeLoteStatus(value) {
  const k = String(value ?? '').trim();
  return LOTE_STATUS_KEYS.has(k) ? k : DEFAULT_LOTE_STATUS;
}

function labelForLoteStatus(key) {
  const k = normalizeLoteStatus(key);
  return LOTE_STATUS_OPCOES.find((o) => o.key === k)?.label || k;
}

function labelForCategoria(key) {
  const k = String(key ?? '').trim();
  if (!k || k === 'undefined') return 'Outro';
  return MATERIAL_CATEGORIAS.find((c) => c.key === k)?.label || k;
}

function resolveItemCategoria(row, atributos = {}) {
  const fromRow = String(row.categoria ?? '').trim();
  if (fromRow && fromRow !== 'undefined') return fromRow;
  const fromAttr = String(atributos?.categoria ?? '').trim();
  if (fromAttr && fromAttr !== 'undefined') return fromAttr;
  if (row.origem === 'entregas') return 'camiseta';
  const modelo = String(row.modelo || '');
  if (/^camiseta\b/i.test(modelo)) return 'camiseta';
  return 'outro';
}

function rowToLote(row) {
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    nome: row.nome || '',
    fornecedor: row.fornecedor || '',
    status: normalizeLoteStatus(row.status),
    statusLabel: labelForLoteStatus(row.status),
    notas: row.notas || '',
    entregasImportadoEm: row.entregas_importado_em
      ? new Date(row.entregas_importado_em).toISOString()
      : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function rowToItem(row) {
  const atributos = parseJsonObject(row.atributos);
  const categoria = resolveItemCategoria(row, atributos);
  return {
    id: Number(row.id),
    loteId: Number(row.lote_id),
    origem: row.origem === 'site' ? 'site' : 'entregas',
    categoria,
    categoriaLabel: labelForCategoria(categoria),
    arrecadacaoId: row.arrecadacao_id != null ? Number(row.arrecadacao_id) : null,
    referencia: row.referencia || '',
    modelo: row.modelo || '',
    tamanho: row.tamanho || '',
    unidade: row.unidade || 'un',
    quantidade: Math.max(1, Number(row.quantidade) || 1),
    ingressoIdx: row.ingresso_idx != null ? Number(row.ingresso_idx) : null,
    atributos,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function modeloCamisetaEntrega(produtoNome) {
  const nome = String(produtoNome || '').trim();
  return nome ? `Camiseta — ${nome}` : 'Camiseta cortesia';
}

export function buildItensFromEntregas(entregasPayload) {
  const lines = [];
  const items = entregasPayload?.items || [];
  for (const item of items) {
    const count = Math.max(
      0,
      Number(item.camisetasSolicitadas ?? item.ingressosSolicitados ?? item.ingressosCortesia) || 0,
    );
    if (!count) continue;
    const modelo = modeloCamisetaEntrega(item.produtoNome);
    const sizes = Array.isArray(item.camisetasTamanhos) ? item.camisetasTamanhos : [];
    for (let i = 0; i < count; i += 1) {
      const tamanho = String(sizes[i] || '').trim().toUpperCase();
      lines.push({
        origem: 'entregas',
        categoria: 'camiseta',
        arrecadacaoId: item.arrecadacaoId,
        referencia: item.participanteNome || '',
        modelo,
        tamanho,
        unidade: 'un',
        quantidade: 1,
        ingressoIdx: i + 1,
        atributos: {
          plano: item.produtoNome || null,
          ingresso: i + 1,
        },
      });
    }
  }
  return lines;
}

function itemEspecificacao(item) {
  const t = String(item.tamanho || '').trim();
  if (t) return t;
  const a = item.atributos && typeof item.atributos === 'object' ? item.atributos : {};
  if (a.dimensoes) return String(a.dimensoes).trim();
  if (a.material) return String(a.material).trim();
  return '—';
}

function aggregateItens(itens) {
  const map = new Map();
  for (const item of itens) {
    const categoria = resolveItemCategoria(
      { categoria: item.categoria, origem: item.origem, modelo: item.modelo },
      item.atributos,
    );
    const modelo = String(item.modelo || '').trim() || '—';
    const especificacao = itemEspecificacao(item);
    const unidade = String(item.unidade || 'un');
    const key = `${categoria}\0${modelo}\0${especificacao}\0${unidade}`;
    const qtd = Math.max(1, Number(item.quantidade) || 1);
    if (!map.has(key)) {
      map.set(key, {
        categoria,
        categoriaLabel: labelForCategoria(categoria),
        modelo,
        especificacao,
        unidade,
        quantidade: 0,
      });
    }
    map.get(key).quantidade += qtd;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.categoriaLabel.localeCompare(b.categoriaLabel, 'pt-BR') ||
      a.modelo.localeCompare(b.modelo, 'pt-BR') ||
      a.especificacao.localeCompare(b.especificacao, 'pt-BR'),
  );
}

async function findLoteRow(pool, loteId, eventoId) {
  const [rows] = await pool.query(
    'SELECT * FROM producao_materiais_lotes WHERE id = ? AND evento_id = ? LIMIT 1',
    [loteId, eventoId],
  );
  return rows[0] || null;
}

export async function migrateProducaoMateriais(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_materiais_lotes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(160) NOT NULL,
      notas TEXT NULL,
      entregas_importado_em DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_producao_materiais_lotes_evento (evento_id),
      CONSTRAINT fk_producao_materiais_lotes_evento
        FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [loteCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producao_materiais_lotes'`,
  );
  const loteColSet = new Set(loteCols.map((r) => r.COLUMN_NAME));
  if (!loteColSet.has('fornecedor')) {
    await pool.query(
      "ALTER TABLE producao_materiais_lotes ADD COLUMN fornecedor VARCHAR(200) NOT NULL DEFAULT '' AFTER nome",
    );
  }
  if (!loteColSet.has('status')) {
    await pool.query(
      "ALTER TABLE producao_materiais_lotes ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'em_criacao' AFTER fornecedor",
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_materiais_itens (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      lote_id INT UNSIGNED NOT NULL,
      origem ENUM('entregas', 'site') NOT NULL DEFAULT 'site',
      arrecadacao_id INT UNSIGNED NULL,
      referencia VARCHAR(200) NOT NULL DEFAULT '',
      modelo VARCHAR(200) NOT NULL,
      tamanho VARCHAR(16) NOT NULL DEFAULT '',
      quantidade SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      ingresso_idx SMALLINT UNSIGNED NULL,
      atributos JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_producao_materiais_itens_lote (lote_id),
      INDEX idx_producao_materiais_itens_origem (lote_id, origem),
      CONSTRAINT fk_producao_materiais_itens_lote
        FOREIGN KEY (lote_id) REFERENCES producao_materiais_lotes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [itemCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producao_materiais_itens'`,
  );
  const itemColSet = new Set(itemCols.map((r) => r.COLUMN_NAME));
  if (!itemColSet.has('categoria')) {
    await pool.query(
      "ALTER TABLE producao_materiais_itens ADD COLUMN categoria VARCHAR(64) NOT NULL DEFAULT 'outro' AFTER origem",
    );
    await pool.query(
      `UPDATE producao_materiais_itens SET categoria = 'camiseta' WHERE origem = 'entregas'`,
    );
  }
  if (!itemColSet.has('unidade')) {
    await pool.query(
      "ALTER TABLE producao_materiais_itens ADD COLUMN unidade VARCHAR(16) NOT NULL DEFAULT 'un' AFTER tamanho",
    );
  }

  await pool.query(
    `UPDATE producao_materiais_itens SET categoria = 'camiseta' WHERE origem = 'entregas' AND (categoria = '' OR categoria = 'outro')`,
  );
}

export async function listMateriaisLotes(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM producao_materiais_itens i WHERE i.lote_id = l.id) AS total_itens
     FROM producao_materiais_lotes l
     WHERE l.evento_id = ?
     ORDER BY l.updated_at DESC, l.id DESC`,
    [eventoId],
  );
  return {
    lotes: rows.map((row) => ({
      ...rowToLote(row),
      totalItens: Number(row.total_itens) || 0,
    })),
    camisetaTamanhos: CAMISETA_TAMANHOS,
    categorias: MATERIAL_CATEGORIAS,
    unidades: MATERIAL_UNIDADES,
    loteStatusOpcoes: LOTE_STATUS_OPCOES,
  };
}

async function loadLoteDetail(pool, loteId, eventoId) {
  const loteRow = await findLoteRow(pool, loteId, eventoId);
  if (!loteRow) return null;

  const [itemRows] = await pool.query(
    `SELECT * FROM producao_materiais_itens
     WHERE lote_id = ?
     ORDER BY origem ASC, modelo ASC, tamanho ASC, referencia ASC, id ASC`,
    [loteId],
  );
  const itens = itemRows.map(rowToItem);
  return {
    lote: rowToLote(loteRow),
    itens,
    resumo: aggregateItens(itens),
    camisetaTamanhos: CAMISETA_TAMANHOS,
    categorias: MATERIAL_CATEGORIAS,
    unidades: MATERIAL_UNIDADES,
    loteStatusOpcoes: LOTE_STATUS_OPCOES,
  };
}

export async function getMateriaisLote(pool, loteId, eventoId) {
  return loadLoteDetail(pool, loteId, eventoId);
}

export async function createMateriaisLote(pool, eventoId, body) {
  const nome = String(body?.nome || '').trim() || 'Lote de produção';
  const fornecedor = String(body?.fornecedor || '').trim();
  const notas = body?.notas != null ? String(body.notas).trim() : '';
  const status = normalizeLoteStatus(body?.status);
  const [result] = await pool.query(
    'INSERT INTO producao_materiais_lotes (evento_id, nome, fornecedor, status, notas) VALUES (?, ?, ?, ?, ?)',
    [eventoId, nome, fornecedor, status, notas || null],
  );
  return loadLoteDetail(pool, result.insertId, eventoId);
}

export async function updateMateriaisLote(pool, loteId, eventoId, body) {
  const existing = await findLoteRow(pool, loteId, eventoId);
  if (!existing) return null;

  const nome =
    body?.nome !== undefined ? String(body.nome).trim() || existing.nome : existing.nome;
  const fornecedor =
    body?.fornecedor !== undefined ? String(body.fornecedor).trim() : existing.fornecedor || '';
  const notas = body?.notas !== undefined ? String(body.notas).trim() : existing.notas || '';
  const status =
    body?.status !== undefined ? normalizeLoteStatus(body.status) : normalizeLoteStatus(existing.status);

  await pool.query(
    `UPDATE producao_materiais_lotes SET nome = ?, fornecedor = ?, status = ?, notas = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [nome, fornecedor, status, notas || null, loteId, eventoId],
  );
  return loadLoteDetail(pool, loteId, eventoId);
}

export async function deleteMateriaisLote(pool, loteId, eventoId) {
  const existing = await findLoteRow(pool, loteId, eventoId);
  if (!existing) return false;
  await pool.query('DELETE FROM producao_materiais_lotes WHERE id = ? AND evento_id = ?', [
    loteId,
    eventoId,
  ]);
  return true;
}

async function insertMateriaisEntregaLine(pool, loteId, line) {
  await pool.query(
    `INSERT INTO producao_materiais_itens (
       lote_id, origem, categoria, arrecadacao_id, referencia, modelo, tamanho, unidade, quantidade, ingresso_idx, atributos
     ) VALUES (?, 'entregas', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      loteId,
      line.categoria || 'camiseta',
      line.arrecadacaoId,
      line.referencia,
      line.modelo,
      line.tamanho || '',
      line.unidade || 'un',
      line.quantidade,
      line.ingressoIdx,
      JSON.stringify(line.atributos || {}),
    ],
  );
}

/**
 * Atualiza camisetas do patrocinador nos lotes que já importaram entregas.
 */
export async function syncMateriaisItensForEntrega(pool, eventoId, arrecadacaoId) {
  const id = Number(arrecadacaoId);
  if (!Number.isInteger(id) || id <= 0) return { lotes: 0, itens: 0 };

  const entregas = await listProducaoEntregas(pool, eventoId);
  const item = entregas.items.find((i) => i.arrecadacaoId === id);
  const lines = item ? buildItensFromEntregas({ items: [item] }) : [];

  const [loteRows] = await pool.query(
    `SELECT id AS lote_id FROM producao_materiais_lotes
     WHERE evento_id = ? AND entregas_importado_em IS NOT NULL`,
    [eventoId],
  );
  if (!loteRows.length) return { lotes: 0, itens: 0 };

  let lotesAfetados = 0;
  let totalItens = 0;

  for (const { lote_id } of loteRows) {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM producao_materiais_itens
       WHERE lote_id = ? AND origem = 'entregas' AND arrecadacao_id = ?`,
      [lote_id, id],
    );
    const hadRows = Number(countRows[0]?.c) > 0;
    if (!hadRows && !lines.length) continue;

    await pool.query(
      `DELETE FROM producao_materiais_itens WHERE lote_id = ? AND origem = 'entregas' AND arrecadacao_id = ?`,
      [lote_id, id],
    );

    for (const line of lines) {
      await insertMateriaisEntregaLine(pool, lote_id, line);
      totalItens += 1;
    }

    if (hadRows || lines.length) {
      lotesAfetados += 1;
      await pool.query(
        `UPDATE producao_materiais_lotes SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [lote_id],
      );
    }
  }

  return { lotes: lotesAfetados, itens: totalItens };
}

export async function importarEntregasMateriaisLote(pool, loteId, eventoId) {
  const existing = await findLoteRow(pool, loteId, eventoId);
  if (!existing) return null;

  const entregas = await listProducaoEntregas(pool, eventoId);
  const lines = buildItensFromEntregas(entregas);

  await pool.query(
    "DELETE FROM producao_materiais_itens WHERE lote_id = ? AND origem = 'entregas'",
    [loteId],
  );

  for (const line of lines) {
    await insertMateriaisEntregaLine(pool, loteId, line);
  }

  await pool.query(
    `UPDATE producao_materiais_lotes
     SET entregas_importado_em = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [loteId, eventoId],
  );

  const detail = await loadLoteDetail(pool, loteId, eventoId);
  return { ...detail, importadosEntregas: lines.length };
}

function normalizeManualItemBody(body) {
  const modelo = String(body?.modelo || body?.produto || '').trim();
  if (!modelo) {
    throw Object.assign(new Error('Informe o produto / modelo'), { status: 400 });
  }
  let categoria = String(body?.categoria || 'outro').trim();
  if (!CATEGORIA_KEYS.has(categoria)) categoria = 'outro';
  let unidade = String(body?.unidade || 'un').trim();
  if (!UNIDADE_SET.has(unidade)) unidade = 'un';
  const allowed = new Set(CAMISETA_TAMANHOS);
  let tamanho = String(body?.tamanho || '').trim().toUpperCase();
  if (tamanho && categoria === 'camiseta' && !allowed.has(tamanho)) {
    throw Object.assign(new Error('Tamanho inválido'), { status: 400 });
  }
  if (categoria !== 'camiseta') tamanho = tamanho || '';
  const quantidade = Math.min(9999, Math.max(1, Math.floor(Number(body?.quantidade) || 1)));
  const referencia = String(body?.referencia ?? body?.cliente ?? body?.pedido ?? '').trim();
  const atributos = parseJsonObject(body?.atributos);
  if (body?.cor !== undefined) atributos.cor = String(body.cor || '').trim();
  if (body?.material !== undefined) atributos.material = String(body.material || '').trim();
  if (body?.dimensoes !== undefined) atributos.dimensoes = String(body.dimensoes || '').trim();
  if (body?.observacao !== undefined) atributos.observacao = String(body.observacao || '').trim();
  if (tamanho) atributos.tamanho = tamanho;
  return { modelo, categoria, unidade, tamanho, quantidade, referencia, atributos };
}

export async function createMateriaisItem(pool, loteId, eventoId, body) {
  const lote = await findLoteRow(pool, loteId, eventoId);
  if (!lote) return null;

  const item = normalizeManualItemBody(body);
  const [result] = await pool.query(
    `INSERT INTO producao_materiais_itens (
       lote_id, origem, categoria, arrecadacao_id, referencia, modelo, tamanho, unidade, quantidade, ingresso_idx, atributos
     ) VALUES (?, 'site', ?, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      loteId,
      item.categoria,
      item.referencia,
      item.modelo,
      item.tamanho || '',
      item.unidade,
      item.quantidade,
      JSON.stringify(item.atributos),
    ],
  );

  await pool.query(
    'UPDATE producao_materiais_lotes SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [loteId],
  );

  const [rows] = await pool.query('SELECT * FROM producao_materiais_itens WHERE id = ? LIMIT 1', [
    result.insertId,
  ]);
  const detail = await loadLoteDetail(pool, loteId, eventoId);
  return { ...detail, item: rowToItem(rows[0]) };
}

export async function updateMateriaisItem(pool, loteId, itemId, eventoId, body) {
  const lote = await findLoteRow(pool, loteId, eventoId);
  if (!lote) return null;

  const [existingRows] = await pool.query(
    'SELECT * FROM producao_materiais_itens WHERE id = ? AND lote_id = ? LIMIT 1',
    [itemId, loteId],
  );
  const existing = existingRows[0];
  if (!existing) return null;

  const item = normalizeManualItemBody({ ...parseJsonObject(existing.atributos), ...body });
  const detachFromEntregas = existing.origem === 'entregas';
  await pool.query(
    `UPDATE producao_materiais_itens SET
       origem = 'site',
       arrecadacao_id = NULL,
       ingresso_idx = NULL,
       categoria = ?, referencia = ?, modelo = ?, tamanho = ?, unidade = ?, quantidade = ?, atributos = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND lote_id = ?`,
    [
      item.categoria,
      item.referencia,
      item.modelo,
      item.tamanho || '',
      item.unidade,
      item.quantidade,
      JSON.stringify(item.atributos),
      itemId,
      loteId,
    ],
  );

  await pool.query(
    'UPDATE producao_materiais_lotes SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [loteId],
  );

  return loadLoteDetail(pool, loteId, eventoId);
}

export async function duplicateMateriaisItem(pool, loteId, itemId, eventoId, body = {}) {
  const lote = await findLoteRow(pool, loteId, eventoId);
  if (!lote) return null;

  const [existingRows] = await pool.query(
    'SELECT * FROM producao_materiais_itens WHERE id = ? AND lote_id = ? LIMIT 1',
    [itemId, loteId],
  );
  const existing = existingRows[0];
  if (!existing) return null;

  const src = rowToItem(existing);
  const qtyOverride = body?.quantidade ?? body?.qtd;
  const quantidade =
    qtyOverride !== undefined && qtyOverride !== ''
      ? Math.min(9999, Math.max(1, Math.floor(Number(qtyOverride) || 1)))
      : Math.max(1, Number(src.quantidade) || 1);

  const payload = {
    categoria: src.categoria,
    modelo: src.modelo,
    referencia: body?.referencia !== undefined ? body.referencia : src.referencia,
    tamanho: src.tamanho,
    unidade: src.unidade,
    quantidade,
    cor: src.atributos?.cor || '',
    material: src.atributos?.material || '',
    dimensoes: src.atributos?.dimensoes || '',
    observacao: src.atributos?.observacao || '',
  };

  const created = await createMateriaisItem(pool, loteId, eventoId, payload);
  return created;
}

export async function moveMateriaisItem(pool, fromLoteId, itemId, eventoId, body = {}) {
  const toLoteId = Number(body.loteDestinoId ?? body.toLoteId ?? body.loteId);
  if (!Number.isInteger(toLoteId) || toLoteId <= 0) {
    throw Object.assign(new Error('Informe o lote de destino'), { status: 400 });
  }
  if (toLoteId === Number(fromLoteId)) {
    throw Object.assign(new Error('Escolha um lote diferente do atual'), { status: 400 });
  }

  const fromLote = await findLoteRow(pool, fromLoteId, eventoId);
  const toLote = await findLoteRow(pool, toLoteId, eventoId);
  if (!fromLote || !toLote) return null;

  const [rows] = await pool.query(
    'SELECT id FROM producao_materiais_itens WHERE id = ? AND lote_id = ? LIMIT 1',
    [itemId, fromLoteId],
  );
  if (!rows[0]) return null;

  await pool.query(
    `UPDATE producao_materiais_itens SET lote_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [toLoteId, itemId],
  );
  await pool.query(
    `UPDATE producao_materiais_lotes SET updated_at = CURRENT_TIMESTAMP(3) WHERE id IN (?, ?)`,
    [fromLoteId, toLoteId],
  );

  return {
    from: await loadLoteDetail(pool, fromLoteId, eventoId),
    to: await loadLoteDetail(pool, toLoteId, eventoId),
    movedItemId: Number(itemId),
    destinoLoteId: toLoteId,
  };
}

export async function deleteMateriaisItem(pool, loteId, itemId, eventoId) {
  const lote = await findLoteRow(pool, loteId, eventoId);
  if (!lote) return null;

  const [existingRows] = await pool.query(
    'SELECT origem FROM producao_materiais_itens WHERE id = ? AND lote_id = ? LIMIT 1',
    [itemId, loteId],
  );
  if (!existingRows[0]) return null;

  await pool.query('DELETE FROM producao_materiais_itens WHERE id = ? AND lote_id = ?', [
    itemId,
    loteId,
  ]);
  await pool.query(
    'UPDATE producao_materiais_lotes SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [loteId],
  );
  return loadLoteDetail(pool, loteId, eventoId);
}

function formatItemDetalhesText(atributos) {
  const a = atributos && typeof atributos === 'object' ? atributos : {};
  const parts = [];
  if (a.material) parts.push(`material: ${a.material}`);
  if (a.cor) parts.push(`cor: ${a.cor}`);
  if (a.dimensoes) parts.push(String(a.dimensoes));
  if (a.observacao) parts.push(String(a.observacao));
  if (a.plano) parts.push(`plano: ${a.plano}`);
  if (a.ingresso) parts.push(`ingresso ${a.ingresso}`);
  return parts.join(' · ');
}

function itemLineEspecificacao(item) {
  const t = String(item.tamanho || '').trim();
  if (t) return t;
  const a = item.atributos && typeof item.atributos === 'object' ? item.atributos : {};
  if (a.dimensoes) return String(a.dimensoes).trim();
  return '—';
}

export function compilePedidoProducaoText({ eventoNome, sections, includeDetalhe = true }) {
  const lines = [];
  const tituloEvento = String(eventoNome || 'Evento').trim() || 'Evento';
  lines.push(`PEDIDO DE PRODUÇÃO / ORÇAMENTO — ${tituloEvento}`);
  lines.push(
    `Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}`,
  );
  lines.push('');

  const validSections = (sections || []).filter((s) => (s.itens || []).length > 0);
  if (!validSections.length) {
    lines.push('Nenhum item cadastrado nos lotes de materiais.');
    return lines.join('\n');
  }

  for (const section of validSections) {
    const { lote, resumo, itens } = section;
    lines.push('─'.repeat(56));
    lines.push(`LOTE: ${lote?.nome || '—'}`);
    if (lote?.fornecedor) lines.push(`Fornecedor: ${lote.fornecedor}`);
    if (lote?.statusLabel || lote?.status) {
      lines.push(`Status: ${lote.statusLabel || labelForLoteStatus(lote.status)}`);
    }
    if (lote?.notas) {
      lines.push('Observações do lote:');
      lines.push(lote.notas);
    }
    lines.push('');
    lines.push('RESUMO PARA ORÇAMENTO E PRODUÇÃO');
    const resumoRows = resumo || [];
    if (!resumoRows.length) {
      lines.push('  (sem resumo)');
    } else {
      for (const row of resumoRows) {
        const esp =
          row.especificacao && row.especificacao !== '—' ? row.especificacao : 'sem especificação';
        const cat = row.categoriaLabel || labelForCategoria(row.categoria);
        lines.push(
          `  • ${cat} | ${row.modelo} | ${esp} | ${row.quantidade} ${row.unidade || 'un'}`,
        );
      }
    }
    const totalPecas = (itens || []).reduce(
      (acc, i) => acc + Math.max(1, Number(i.quantidade) || 1),
      0,
    );
    lines.push(`  Total no lote: ${totalPecas} unidade(s)`);
    lines.push('');

    if (includeDetalhe && itens?.length) {
      lines.push('DETALHAMENTO');
      for (const item of itens) {
        const cat = item.categoriaLabel || labelForCategoria(item.categoria);
        const esp = itemLineEspecificacao(item);
        const ref = item.referencia ? ` — ${item.referencia}` : '';
        const det = formatItemDetalhesText(item.atributos);
        const detSuffix = det ? ` (${det})` : '';
        lines.push(
          `  • [${cat}] ${item.modelo} | ${esp} | ${item.quantidade} ${item.unidade || 'un'}${ref}${detSuffix}`,
        );
      }
      lines.push('');
    }
  }

  lines.push('─'.repeat(56));
  lines.push('Favor enviar orçamento e prazo de produção.');
  return lines.join('\n');
}

export async function getPedidoProducaoTexto(pool, eventoId, { loteId, detalhe = true } = {}) {
  const [eventoRows] = await pool.query('SELECT nome FROM eventos WHERE id = ? LIMIT 1', [eventoId]);
  const eventoNome = eventoRows[0]?.nome || 'Evento';
  const includeDetalhe = detalhe !== false && detalhe !== '0' && detalhe !== 'false';

  let sections = [];
  if (loteId != null && loteId !== '') {
    const id = Number(loteId);
    const detail = await loadLoteDetail(pool, id, eventoId);
    if (!detail) return null;
    sections = [detail];
  } else {
    const [loteRows] = await pool.query(
      `SELECT id FROM producao_materiais_lotes WHERE evento_id = ? ORDER BY updated_at DESC, id DESC`,
      [eventoId],
    );
    for (const row of loteRows) {
      const detail = await loadLoteDetail(pool, row.id, eventoId);
      if (detail?.itens?.length) sections.push(detail);
    }
  }

  return {
    eventoNome,
    texto: compilePedidoProducaoText({ eventoNome, sections, includeDetalhe }),
    lotes: sections.length,
    includeDetalhe,
  };
}
