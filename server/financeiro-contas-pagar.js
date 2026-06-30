import { findEventoById } from './eventos.js';
import { inferFaseContaPagar } from '../shared/financeiro-fase.js';

const STATUS = ['pendente', 'parcial', 'pago', 'cancelado'];
const FASE = ['pre', 'pos'];

const DEFAULT_CATEGORIAS = [
  'RH',
  'MKT',
  'Produção',
  'Infraestrutura',
  'Alimentação',
  'Artístico',
  'Reserva',
  'Impostos',
  'Outros',
];

function parseMoney(raw, label) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let s = String(raw).trim().replace(/^R\$/i, '').replace(/\s/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${label} inválido`), { status: 400 });
  }
  return negative ? -n : n;
}

function parseDateOnlyParts(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: m[1], mo: m[2], d: m[3] };
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { y: m[3], mo: m[2], d: m[1] };
  return null;
}

function formatDateOnlyIso(raw) {
  const p = parseDateOnlyParts(raw);
  if (!p) return String(raw ?? '').trim();
  return `${p.y}-${p.mo}-${p.d}`;
}

function normalizeDateOnly(raw, { label = 'Data' } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const p = parseDateOnlyParts(s);
  if (!p) {
    throw Object.assign(new Error(`${label} inválida (use AAAA-MM-DD ou DD/MM/AAAA)`), { status: 400 });
  }
  return `${p.y}-${p.mo}-${p.d}`;
}

function inferStatus(valorPrevisto, valorPago, explicit) {
  if (explicit === 'cancelado') return 'cancelado';
  const prev = Number(valorPrevisto) || 0;
  const pago = Number(valorPago) || 0;
  if (pago <= 0) return 'pendente';
  if (prev > 0 && pago >= prev) return 'pago';
  return 'parcial';
}

function rowToCategoria(row) {
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    nome: row.nome,
    ordem: Number(row.ordem),
    ativo: row.ativo == null ? true : Boolean(Number(row.ativo)),
    usoContas: Number(row.uso_contas) || 0,
    usoPlanos: Number(row.uso_planos) || 0,
  };
}

function rowToPlanoConta(row) {
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    categoriaId: Number(row.categoria_id),
    categoriaNome: row.categoria_nome || '',
    codigo: row.codigo || '',
    nome: row.nome,
    ordem: Number(row.ordem),
    ativo: row.ativo == null ? true : Boolean(Number(row.ativo)),
    usoContas: Number(row.uso_contas) || 0,
  };
}

function normalizeFase(raw) {
  if (raw == null || raw === '') return 'pre';
  if (typeof raw === 'boolean') return raw ? 'pre' : 'pos';
  const s = String(raw).toLowerCase().trim();
  if (s === 'pos' || s === 'pos_evento' || s === 'pos-evento' || s === 'pós-evento' || s === 'pós') {
    return 'pos';
  }
  if (s === 'pre' || s === 'pre_evento' || s === 'pre-evento' || s === 'pré-evento' || s === 'pré') {
    return 'pre';
  }
  if (raw.preEvento === false || raw.pre_evento === false || raw.pre_evento === 0) return 'pos';
  if (raw.preEvento === true || raw.pre_evento === true || raw.pre_evento === 1) return 'pre';
  return 'pre';
}

function rowToConta(row) {
  const valorPrevisto = Number(row.valor_previsto);
  const valorPago = Number(row.valor_pago);
  const fase = FASE.includes(row.fase) ? row.fase : 'pre';
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    categoriaId: Number(row.categoria_id),
    categoriaNome: row.categoria_nome || '',
    planoContaId: Number(row.plano_conta_id),
    planoContaCodigo: row.plano_codigo || '',
    planoContaNome: row.plano_nome || '',
    fornecedor: row.fornecedor || '',
    descricao: row.descricao || '',
    fase,
    valorPrevisto,
    valorPago,
    valorFalta: Math.max(0, valorPrevisto - valorPago),
    dtVencimento: formatDateOnlyIso(row.dt_vencimento),
    dtPagamento: formatDateOnlyIso(row.dt_pagamento),
    status: row.status || inferStatus(valorPrevisto, valorPago),
    obs: row.obs || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const CONTA_SELECT = `
  SELECT cp.id, cp.evento_id, cp.categoria_id, cp.plano_conta_id, cp.fornecedor, cp.descricao, cp.fase,
         cp.valor_previsto, cp.valor_pago, cp.dt_vencimento, cp.dt_pagamento, cp.status, cp.obs,
         cp.created_at, cp.updated_at,
         cat.nome AS categoria_nome,
         pc.codigo AS plano_codigo, pc.nome AS plano_nome
  FROM financeiro_contas_pagar cp
  JOIN financeiro_categorias cat ON cat.id = cp.categoria_id
  JOIN financeiro_plano_contas pc ON pc.id = cp.plano_conta_id
`;

export async function migrateFinanceiroContasPagar(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financeiro_categorias (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(80) NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_fin_cat_evento_nome (evento_id, nome),
      INDEX idx_fin_cat_evento (evento_id),
      CONSTRAINT fk_fin_cat_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS financeiro_plano_contas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      categoria_id INT UNSIGNED NOT NULL,
      codigo VARCHAR(20) NOT NULL DEFAULT '',
      nome VARCHAR(120) NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_fin_pc_evento (evento_id),
      INDEX idx_fin_pc_categoria (categoria_id),
      CONSTRAINT fk_fin_pc_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
      CONSTRAINT fk_fin_pc_categoria FOREIGN KEY (categoria_id) REFERENCES financeiro_categorias(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS financeiro_contas_pagar (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      categoria_id INT UNSIGNED NOT NULL,
      plano_conta_id INT UNSIGNED NOT NULL,
      fornecedor VARCHAR(160) NULL,
      descricao VARCHAR(255) NOT NULL,
      fase ENUM('pre', 'pos') NOT NULL DEFAULT 'pre',
      valor_previsto DECIMAL(14,2) NOT NULL DEFAULT 0,
      valor_pago DECIMAL(14,2) NOT NULL DEFAULT 0,
      dt_vencimento VARCHAR(20) NULL,
      dt_pagamento VARCHAR(20) NULL,
      status ENUM('pendente', 'parcial', 'pago', 'cancelado') NOT NULL DEFAULT 'pendente',
      obs TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_fin_cp_evento (evento_id),
      INDEX idx_fin_cp_status (evento_id, status),
      CONSTRAINT fk_fin_cp_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
      CONSTRAINT fk_fin_cp_categoria FOREIGN KEY (categoria_id) REFERENCES financeiro_categorias(id),
      CONSTRAINT fk_fin_cp_plano FOREIGN KEY (plano_conta_id) REFERENCES financeiro_plano_contas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const table of ['financeiro_categorias', 'financeiro_plano_contas']) {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'ativo'`,
      [table],
    );
    if (!cols.length) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1`);
    }
  }

  const [faseCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'financeiro_contas_pagar' AND COLUMN_NAME = 'fase'`,
  );
  if (!faseCols.length) {
    await pool.query(
      `ALTER TABLE financeiro_contas_pagar
       ADD COLUMN fase ENUM('pre', 'pos') NOT NULL DEFAULT 'pre' AFTER descricao`,
    );
  }
}

async function ensureDefaultCategorias(pool, eventoId) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM financeiro_categorias WHERE evento_id = ?',
    [eventoId],
  );
  if (Number(rows[0]?.n || 0) > 0) return;

  for (let i = 0; i < DEFAULT_CATEGORIAS.length; i += 1) {
    const nome = DEFAULT_CATEGORIAS[i];
    const [result] = await pool.query(
      'INSERT INTO financeiro_categorias (evento_id, nome, ordem) VALUES (?, ?, ?)',
      [eventoId, nome, i],
    );
    const catId = result.insertId;
    await pool.query(
      `INSERT INTO financeiro_plano_contas (evento_id, categoria_id, codigo, nome, ordem)
       VALUES (?, ?, ?, ?, 0)`,
      [eventoId, catId, `${i + 1}.1`, `Despesas — ${nome}`],
    );
  }
}

export async function listFinanceiroCategorias(pool, eventoId, { gestao = false } = {}) {
  await ensureDefaultCategorias(pool, eventoId);
  const ativoClause = gestao ? '' : ' AND c.ativo = 1';
  const [rows] = await pool.query(
    `SELECT c.id, c.evento_id, c.nome, c.ordem, c.ativo,
            (SELECT COUNT(*) FROM financeiro_contas_pagar cp WHERE cp.categoria_id = c.id) AS uso_contas,
            (SELECT COUNT(*) FROM financeiro_plano_contas pc WHERE pc.categoria_id = c.id) AS uso_planos
     FROM financeiro_categorias c
     WHERE c.evento_id = ?${ativoClause}
     ORDER BY c.ordem ASC, c.nome ASC`,
    [eventoId],
  );
  return rows.map(rowToCategoria);
}

export async function createFinanceiroCategoria(pool, eventoId, raw) {
  await ensureDefaultCategorias(pool, eventoId);
  const nome = String(raw.nome ?? '').trim();
  if (!nome) throw Object.assign(new Error('Informe a categoria'), { status: 400 });

  const [existing] = await pool.query(
    `SELECT id, evento_id, nome, ordem, ativo FROM financeiro_categorias
     WHERE evento_id = ? AND LOWER(nome) = LOWER(?)
     LIMIT 1`,
    [eventoId, nome],
  );
  if (existing[0]) {
    if (!Number(existing[0].ativo)) {
      await pool.query('UPDATE financeiro_categorias SET ativo = 1 WHERE id = ?', [existing[0].id]);
      existing[0].ativo = 1;
    }
    return rowToCategoria(existing[0]);
  }

  const [maxOrd] = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem FROM financeiro_categorias WHERE evento_id = ?',
    [eventoId],
  );
  const ordem = Number(maxOrd[0]?.next_ordem) || 0;
  const ativo = raw.ativo === false || raw.ativo === 0 ? 0 : 1;
  const [result] = await pool.query(
    'INSERT INTO financeiro_categorias (evento_id, nome, ordem, ativo) VALUES (?, ?, ?, ?)',
    [eventoId, nome, ordem, ativo],
  );
  return rowToCategoria({ id: result.insertId, evento_id: eventoId, nome, ordem, ativo });
}

export async function listFinanceiroPlanoContas(pool, eventoId, { categoriaId, gestao = false } = {}) {
  await ensureDefaultCategorias(pool, eventoId);
  const params = [eventoId];
  let where = 'pc.evento_id = ?';
  if (!gestao) where += ' AND pc.ativo = 1 AND cat.ativo = 1';
  if (categoriaId) {
    where += ' AND pc.categoria_id = ?';
    params.push(Number(categoriaId));
  }
  const [rows] = await pool.query(
    `SELECT pc.id, pc.evento_id, pc.categoria_id, pc.codigo, pc.nome, pc.ordem, pc.ativo,
            cat.nome AS categoria_nome,
            (SELECT COUNT(*) FROM financeiro_contas_pagar cp WHERE cp.plano_conta_id = pc.id) AS uso_contas
     FROM financeiro_plano_contas pc
     JOIN financeiro_categorias cat ON cat.id = pc.categoria_id
     WHERE ${where}
     ORDER BY cat.ordem ASC, pc.ordem ASC, pc.codigo ASC, pc.nome ASC`,
    params,
  );
  return rows.map(rowToPlanoConta);
}

export async function createFinanceiroPlanoConta(pool, eventoId, raw) {
  const categoriaId = Number(raw.categoriaId ?? raw.categoria_id);
  if (!categoriaId) {
    throw Object.assign(new Error('Selecione a categoria'), { status: 400 });
  }
  const nome = String(raw.nome ?? '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome da conta'), { status: 400 });
  const codigo = String(raw.codigo ?? '').trim();
  const [cat] = await pool.query(
    'SELECT id FROM financeiro_categorias WHERE id = ? AND evento_id = ?',
    [categoriaId, eventoId],
  );
  if (!cat.length) throw Object.assign(new Error('Categoria não encontrada'), { status: 404 });

  const [existing] = await pool.query(
    `SELECT pc.id, pc.evento_id, pc.categoria_id, pc.codigo, pc.nome, pc.ordem, pc.ativo, cat.nome AS categoria_nome
     FROM financeiro_plano_contas pc
     JOIN financeiro_categorias cat ON cat.id = pc.categoria_id
     WHERE pc.evento_id = ? AND pc.categoria_id = ? AND LOWER(pc.nome) = LOWER(?)
     LIMIT 1`,
    [eventoId, categoriaId, nome],
  );
  if (existing[0]) {
    if (!Number(existing[0].ativo)) {
      await pool.query('UPDATE financeiro_plano_contas SET ativo = 1 WHERE id = ?', [existing[0].id]);
      existing[0].ativo = 1;
    }
    return rowToPlanoConta(existing[0]);
  }

  const [result] = await pool.query(
    `INSERT INTO financeiro_plano_contas (evento_id, categoria_id, codigo, nome, ordem, ativo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [eventoId, categoriaId, codigo, nome, Number(raw.ordem) || 0, raw.ativo === false || raw.ativo === 0 ? 0 : 1],
  );
  const items = await listFinanceiroPlanoContas(pool, eventoId);
  return items.find((p) => p.id === result.insertId) || null;
}

async function findCategoriaById(pool, id, eventoId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.evento_id, c.nome, c.ordem, c.ativo,
            (SELECT COUNT(*) FROM financeiro_contas_pagar cp WHERE cp.categoria_id = c.id) AS uso_contas,
            (SELECT COUNT(*) FROM financeiro_plano_contas pc WHERE pc.categoria_id = c.id) AS uso_planos
     FROM financeiro_categorias c
     WHERE c.id = ? AND c.evento_id = ? LIMIT 1`,
    [id, eventoId],
  );
  return rows[0] ? rowToCategoria(rows[0]) : null;
}

async function findPlanoContaById(pool, id, eventoId) {
  const [rows] = await pool.query(
    `SELECT pc.id, pc.evento_id, pc.categoria_id, pc.codigo, pc.nome, pc.ordem, pc.ativo,
            cat.nome AS categoria_nome,
            (SELECT COUNT(*) FROM financeiro_contas_pagar cp WHERE cp.plano_conta_id = pc.id) AS uso_contas
     FROM financeiro_plano_contas pc
     JOIN financeiro_categorias cat ON cat.id = pc.categoria_id
     WHERE pc.id = ? AND pc.evento_id = ? LIMIT 1`,
    [id, eventoId],
  );
  return rows[0] ? rowToPlanoConta(rows[0]) : null;
}

export async function updateFinanceiroCategoria(pool, id, eventoId, raw) {
  const current = await findCategoriaById(pool, id, eventoId);
  if (!current) return null;

  const nome = raw.nome !== undefined ? String(raw.nome).trim() : current.nome;
  if (!nome) throw Object.assign(new Error('Informe o nome da categoria'), { status: 400 });

  const [dup] = await pool.query(
    `SELECT id FROM financeiro_categorias
     WHERE evento_id = ? AND LOWER(nome) = LOWER(?) AND id <> ? LIMIT 1`,
    [eventoId, nome, id],
  );
  if (dup.length) {
    throw Object.assign(new Error('Já existe outra categoria com este nome'), { status: 400 });
  }

  const ativo = raw.ativo !== undefined ? (raw.ativo ? 1 : 0) : current.ativo ? 1 : 0;
  const ordem = raw.ordem !== undefined ? Number(raw.ordem) : current.ordem;

  await pool.query(
    'UPDATE financeiro_categorias SET nome = ?, ativo = ?, ordem = ? WHERE id = ? AND evento_id = ?',
    [nome, ativo, ordem, id, eventoId],
  );
  return findCategoriaById(pool, id, eventoId);
}

export async function deleteFinanceiroCategoria(pool, id, eventoId) {
  const current = await findCategoriaById(pool, id, eventoId);
  if (!current) return false;
  if (current.usoContas > 0) {
    throw Object.assign(
      new Error(`Não é possível excluir: ${current.usoContas} conta(s) a pagar vinculada(s). Inative a categoria.`),
      { status: 400 },
    );
  }
  const [result] = await pool.query(
    'DELETE FROM financeiro_categorias WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function updateFinanceiroPlanoConta(pool, id, eventoId, raw) {
  const current = await findPlanoContaById(pool, id, eventoId);
  if (!current) return null;

  const nome = raw.nome !== undefined ? String(raw.nome).trim() : current.nome;
  if (!nome) throw Object.assign(new Error('Informe o nome da conta'), { status: 400 });
  const codigo = raw.codigo !== undefined ? String(raw.codigo).trim() : current.codigo;
  const categoriaId =
    raw.categoriaId !== undefined ? Number(raw.categoriaId ?? raw.categoria_id) : current.categoriaId;
  const ativo = raw.ativo !== undefined ? (raw.ativo ? 1 : 0) : current.ativo ? 1 : 0;
  const ordem = raw.ordem !== undefined ? Number(raw.ordem) : current.ordem;

  const [cat] = await pool.query(
    'SELECT id FROM financeiro_categorias WHERE id = ? AND evento_id = ?',
    [categoriaId, eventoId],
  );
  if (!cat.length) throw Object.assign(new Error('Categoria não encontrada'), { status: 404 });

  const [dup] = await pool.query(
    `SELECT id FROM financeiro_plano_contas
     WHERE evento_id = ? AND categoria_id = ? AND LOWER(nome) = LOWER(?) AND id <> ? LIMIT 1`,
    [eventoId, categoriaId, nome, id],
  );
  if (dup.length) {
    throw Object.assign(new Error('Já existe outro plano de contas com este nome nesta categoria'), {
      status: 400,
    });
  }

  await pool.query(
    `UPDATE financeiro_plano_contas SET categoria_id = ?, codigo = ?, nome = ?, ativo = ?, ordem = ?
     WHERE id = ? AND evento_id = ?`,
    [categoriaId, codigo, nome, ativo, ordem, id, eventoId],
  );
  return findPlanoContaById(pool, id, eventoId);
}

export async function deleteFinanceiroPlanoConta(pool, id, eventoId) {
  const current = await findPlanoContaById(pool, id, eventoId);
  if (!current) return false;
  if (current.usoContas > 0) {
    throw Object.assign(
      new Error(`Não é possível excluir: ${current.usoContas} conta(s) a pagar vinculada(s). Inative o plano.`),
      { status: 400 },
    );
  }
  const [result] = await pool.query(
    'DELETE FROM financeiro_plano_contas WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

function normalizeContaInput(raw, { forInsert = false } = {}) {
  const categoriaId = Number(raw.categoriaId ?? raw.categoria_id);
  const planoContaId = Number(raw.planoContaId ?? raw.plano_conta_id);
  const descricao = String(raw.descricao ?? '').trim();
  const fornecedor = String(raw.fornecedor ?? '').trim() || null;
  const valorPrevisto = parseMoney(raw.valorPrevisto ?? raw.valor_previsto, 'Valor previsto');
  const valorPago = parseMoney(raw.valorPago ?? raw.valor_pago ?? 0, 'Valor pago');
  const dtVencimento = normalizeDateOnly(raw.dtVencimento ?? raw.dt_vencimento, {
    label: 'Data de vencimento',
  });
  const dtPagamento = normalizeDateOnly(raw.dtPagamento ?? raw.dt_pagamento, {
    label: 'Data de pagamento',
  });
  const obs = String(raw.obs ?? '').trim() || null;
  const fase = normalizeFase(raw.fase ?? raw.preEvento ?? raw.pre_evento);
  let status = String(raw.status ?? '').toLowerCase();
  if (!STATUS.includes(status)) status = inferStatus(valorPrevisto, valorPago);

  if (forInsert) {
    if (!categoriaId) throw Object.assign(new Error('Selecione a categoria'), { status: 400 });
    if (!planoContaId) throw Object.assign(new Error('Selecione o plano de contas'), { status: 400 });
    if (!descricao) throw Object.assign(new Error('Informe a descrição'), { status: 400 });
    if (valorPrevisto <= 0) throw Object.assign(new Error('Informe o valor previsto'), { status: 400 });
  }

  return {
    categoriaId,
    planoContaId,
    fornecedor,
    descricao,
    fase,
    valorPrevisto,
    valorPago,
    dtVencimento,
    dtPagamento,
    status,
    obs,
  };
}

async function applyAutoFase(pool, eventoId, data, raw) {
  if (raw?.autoFase === false) return;
  const evento = await findEventoById(pool, eventoId);
  const inferred = inferFaseContaPagar({
    evento,
    dtVencimento: data.dtVencimento,
    dtPagamento: data.dtPagamento,
  });
  if (inferred) data.fase = inferred;
}

async function validateContaRefs(pool, eventoId, data) {
  const [pc] = await pool.query(
    `SELECT pc.id, pc.categoria_id, pc.ativo FROM financeiro_plano_contas pc
     WHERE pc.id = ? AND pc.evento_id = ?`,
    [data.planoContaId, eventoId],
  );
  if (!pc.length) throw Object.assign(new Error('Plano de contas não encontrado'), { status: 404 });
  if (!Number(pc[0].ativo)) {
    throw Object.assign(new Error('Plano de contas inativo'), { status: 400 });
  }
  if (Number(pc[0].categoria_id) !== data.categoriaId) {
    throw Object.assign(new Error('O plano de contas não pertence à categoria selecionada'), {
      status: 400,
    });
  }
  const [cat] = await pool.query(
    'SELECT id, ativo FROM financeiro_categorias WHERE id = ? AND evento_id = ?',
    [data.categoriaId, eventoId],
  );
  if (!cat.length) throw Object.assign(new Error('Categoria não encontrada'), { status: 404 });
  if (!Number(cat[0].ativo)) {
    throw Object.assign(new Error('Categoria inativa'), { status: 400 });
  }
}

export async function listContasPagar(pool, eventoId) {
  await ensureDefaultCategorias(pool, eventoId);
  const [rows] = await pool.query(
    `${CONTA_SELECT} WHERE cp.evento_id = ? ORDER BY cp.dt_vencimento ASC, cp.id ASC`,
    [eventoId],
  );
  return rows.map(rowToConta);
}

export async function findContaPagarById(pool, id, eventoId) {
  const [rows] = await pool.query(`${CONTA_SELECT} WHERE cp.id = ? AND cp.evento_id = ? LIMIT 1`, [
    id,
    eventoId,
  ]);
  return rows[0] ? rowToConta(rows[0]) : null;
}

export async function createContaPagar(pool, eventoId, raw) {
  const data = normalizeContaInput(raw, { forInsert: true });
  await validateContaRefs(pool, eventoId, data);
  await applyAutoFase(pool, eventoId, data, raw);

  const [result] = await pool.query(
    `INSERT INTO financeiro_contas_pagar (
       evento_id, categoria_id, plano_conta_id, fornecedor, descricao, fase,
       valor_previsto, valor_pago, dt_vencimento, dt_pagamento, status, obs, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      data.categoriaId,
      data.planoContaId,
      data.fornecedor,
      data.descricao,
      data.fase,
      data.valorPrevisto,
      data.valorPago,
      data.dtVencimento,
      data.dtPagamento,
      data.status,
      data.obs,
    ],
  );
  return findContaPagarById(pool, result.insertId, eventoId);
}

export async function updateContaPagar(pool, id, eventoId, raw) {
  const data = normalizeContaInput(raw);
  await validateContaRefs(pool, eventoId, data);
  await applyAutoFase(pool, eventoId, data, raw);

  const [result] = await pool.query(
    `UPDATE financeiro_contas_pagar SET
       categoria_id = ?, plano_conta_id = ?, fornecedor = ?, descricao = ?, fase = ?,
       valor_previsto = ?, valor_pago = ?, dt_vencimento = ?, dt_pagamento = ?,
       status = ?, obs = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      data.categoriaId,
      data.planoContaId,
      data.fornecedor,
      data.descricao,
      data.fase,
      data.valorPrevisto,
      data.valorPago,
      data.dtVencimento,
      data.dtPagamento,
      data.status,
      data.obs,
      id,
      eventoId,
    ],
  );
  if (result.affectedRows === 0) return null;
  return findContaPagarById(pool, id, eventoId);
}

export async function deleteContaPagar(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM financeiro_contas_pagar WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function bulkUpdateContasPagarFase(pool, eventoId, raw) {
  const ids = Array.isArray(raw?.ids) ? raw.ids : [];
  const fase = normalizeFase(raw?.fase);
  const validIds = [
    ...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];

  if (!validIds.length) {
    throw Object.assign(new Error('Informe ao menos uma conta'), { status: 400 });
  }

  const placeholders = validIds.map(() => '?').join(',');
  const [result] = await pool.query(
    `UPDATE financeiro_contas_pagar SET fase = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE evento_id = ? AND id IN (${placeholders}) AND status != 'cancelado'`,
    [fase, eventoId, ...validIds],
  );

  const contas = await listContasPagar(pool, eventoId);
  const { totais } = summarizeContasPagar(contas);
  return { updated: result.affectedRows, contas, totais };
}

export function summarizeContasPagar(contas) {
  const ativas = contas.filter((c) => c.status !== 'cancelado');
  const byCategoria = new Map();

  let totalPrevisto = 0;
  let totalPago = 0;
  let previstoPre = 0;
  let previstoPos = 0;
  let realizadoPre = 0;
  let realizadoPos = 0;

  for (const c of ativas) {
    const prev = Number(c.valorPrevisto) || 0;
    const pago = Number(c.valorPago) || 0;
    totalPrevisto += prev;
    totalPago += pago;
    if (c.fase === 'pos') {
      previstoPos += prev;
      realizadoPos += pago;
    } else {
      previstoPre += prev;
      realizadoPre += pago;
    }
    const key = c.categoriaNome || 'Outros';
    if (!byCategoria.has(key)) {
      byCategoria.set(key, { nome: key, previsto: 0, realizado: 0, itens: 0 });
    }
    const bucket = byCategoria.get(key);
    bucket.previsto += prev;
    bucket.realizado += pago;
    bucket.itens += 1;
  }

  const categorias = [...byCategoria.values()]
    .map((c) => ({ ...c, falta: Math.max(0, c.previsto - c.realizado) }))
    .sort((a, b) => b.previsto - a.previsto);

  return {
    categorias,
    totais: {
      previsto: totalPrevisto,
      realizado: totalPago,
      falta: Math.max(0, totalPrevisto - totalPago),
      previstoPre,
      previstoPos,
      previstoGeral: totalPrevisto,
      realizadoPre,
      realizadoPos,
      realizadoGeral: totalPago,
    },
  };
}
