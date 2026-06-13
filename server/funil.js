const ETAPA_TIPOS = new Set(['normal', 'perda', 'venda']);

export const FUNIL_ESCOPOS = [
  { id: 'comercial', label: 'Arrecadação', descricao: 'Patrocínios e negociações comerciais' },
  { id: 'artistico', label: 'Artístico', descricao: 'Artistas, atrações e orçamentos' },
];

const ESCOPO_IDS = new Set(FUNIL_ESCOPOS.map((e) => e.id));

const DEFAULT_LABELS = {
  disp: 'Disponível',
  lead: 'Lead',
  neg: 'Em negociação',
  res: 'Reservado',
  vend: 'Vendido / Fechado',
  perda: 'Perda',
};

const DEFAULT_COLORS = {
  disp: '#5DCAA5',
  lead: '#C084FC',
  neg: '#85B7EB',
  res: '#FAC775',
  vend: '#E24B4A',
  perda: '#888888',
};

const DEFAULT_FUNIL = [
  { status: 'lead', titulo: 'Lead', cor: DEFAULT_COLORS.lead, tipo: 'normal', ordem: 0, ativo: true },
  { status: 'neg', titulo: 'Em negociação', cor: DEFAULT_COLORS.neg, tipo: 'normal', ordem: 1, ativo: true },
  { status: 'res', titulo: 'Reservado', cor: DEFAULT_COLORS.res, tipo: 'normal', ordem: 2, ativo: true },
  { status: 'vend', titulo: 'Vendido / Fechado', cor: DEFAULT_COLORS.vend, tipo: 'venda', ordem: 3, ativo: true },
  { status: 'perda', titulo: 'Perda', cor: DEFAULT_COLORS.perda, tipo: 'perda', ordem: 4, ativo: true },
];

const DEFAULT_FUNIL_ARTISTICO = [
  { status: 'lead', titulo: 'Novo lead', cor: DEFAULT_COLORS.lead, tipo: 'normal', ordem: 0, ativo: true },
  { status: 'neg', titulo: 'Primeiro contato', cor: DEFAULT_COLORS.neg, tipo: 'normal', ordem: 1, ativo: true },
  {
    status: 'proposta',
    titulo: 'Proposta enviada',
    cor: '#FAC775',
    tipo: 'normal',
    ordem: 2,
    ativo: true,
  },
  { status: 'vend', titulo: 'Fechado', cor: DEFAULT_COLORS.vend, tipo: 'venda', ordem: 3, ativo: true },
  { status: 'perda', titulo: 'Perda', cor: DEFAULT_COLORS.perda, tipo: 'perda', ordem: 4, ativo: true },
];

export function normalizeFunilEscopo(value, fallback = 'comercial') {
  const escopo = String(value || fallback).trim();
  if (!ESCOPO_IDS.has(escopo)) {
    throw Object.assign(new Error(`Escopo de funil inválido: ${escopo}`), { status: 400 });
  }
  return escopo;
}

export function funilEscopoForTipo(tipo) {
  return tipo === 'artistico' ? 'artistico' : 'comercial';
}

function rowToEtapa(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    escopo: row.escopo || 'comercial',
    status: row.status,
    titulo: row.titulo,
    tipo: row.tipo || 'normal',
    cor: row.cor,
    ordem: Number(row.ordem),
    ativo: Boolean(row.ativo),
  };
}

function defaultEtapasForEscopo(escopo) {
  const base = escopo === 'artistico' ? DEFAULT_FUNIL_ARTISTICO : DEFAULT_FUNIL;
  return base.map((e) => ({
    id: null,
    eventoId: null,
    escopo,
    ...e,
  }));
}

export function defaultFunilEtapas(escopo = 'comercial') {
  return defaultEtapasForEscopo(normalizeFunilEscopo(escopo));
}

function slugify(text) {
  return (
    String(text || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28) || 'etapa'
  );
}

function uniqueStatus(base, used) {
  let slug = slugify(base);
  if (!used.has(slug)) return slug;
  let n = 2;
  while (used.has(`${slug}_${n}`)) n += 1;
  return `${slug}_${n}`;
}

function normalizeTipo(value) {
  const tipo = String(value || 'normal').trim();
  if (!ETAPA_TIPOS.has(tipo)) {
    throw Object.assign(new Error(`Tipo de etapa inválido: ${tipo}`), { status: 400 });
  }
  return tipo;
}

function normalizeEtapaInput(raw, index, usedStatuses) {
  const titulo = String(raw.titulo || '').trim();
  if (!titulo) {
    throw Object.assign(new Error(`Informe o nome da etapa ${index + 1}`), { status: 400 });
  }

  let status = String(raw.status || '').trim();
  if (!status) {
    status = uniqueStatus(titulo, usedStatuses);
  }
  if (status.length > 32 || !/^[a-z0-9_]+$/.test(status)) {
    throw Object.assign(new Error(`Identificador inválido na etapa "${titulo}"`), { status: 400 });
  }
  if (usedStatuses.has(status)) {
    throw Object.assign(new Error(`Etapa duplicada: ${titulo}`), { status: 400 });
  }
  usedStatuses.add(status);

  const tipo = normalizeTipo(raw.tipo);
  const cor = String(raw.cor || '#85B7EB').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(cor)) {
    throw Object.assign(new Error(`Cor inválida na etapa "${titulo}"`), { status: 400 });
  }

  return {
    status,
    titulo,
    tipo,
    cor,
    ordem: Number.isFinite(Number(raw.ordem)) ? Number(raw.ordem) : index,
    ativo: raw.ativo === false || raw.ativo === 0 ? false : true,
  };
}

export async function migrateFunil(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arrecadacao_funil_etapas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      status VARCHAR(32) NOT NULL,
      titulo VARCHAR(100) NOT NULL,
      cor VARCHAR(20) NOT NULL DEFAULT '#85B7EB',
      ordem INT UNSIGNED NOT NULL DEFAULT 0,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_funil_evento_status (evento_id, status),
      INDEX idx_funil_evento_ordem (evento_id, ordem),
      CONSTRAINT fk_funil_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [statusCol] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS max_len FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_funil_etapas' AND COLUMN_NAME = 'status'`,
  );
  if (statusCol[0]?.max_len != null && Number(statusCol[0].max_len) < 32) {
    await pool.query(
      'ALTER TABLE arrecadacao_funil_etapas MODIFY status VARCHAR(32) NOT NULL',
    );
  }

  const [tipoCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_funil_etapas' AND COLUMN_NAME = 'tipo'`,
  );
  if (!tipoCol.length) {
    await pool.query(
      `ALTER TABLE arrecadacao_funil_etapas
         ADD COLUMN tipo VARCHAR(10) NOT NULL DEFAULT 'normal' AFTER titulo`,
    );
    await pool.query(`UPDATE arrecadacao_funil_etapas SET tipo = 'venda' WHERE status = 'vend'`);
    await pool.query(`UPDATE arrecadacao_funil_etapas SET tipo = 'perda' WHERE status = 'perda'`);
  }

  const [escopoCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_funil_etapas' AND COLUMN_NAME = 'escopo'`,
  );
  if (!escopoCol.length) {
    await pool.query(
      `ALTER TABLE arrecadacao_funil_etapas
         ADD COLUMN escopo VARCHAR(32) NOT NULL DEFAULT 'comercial' AFTER evento_id`,
    );
    await pool.query(`UPDATE arrecadacao_funil_etapas SET escopo = 'comercial'`);
  }

  const [indexes] = await pool.query(
    `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_funil_etapas' AND INDEX_NAME = 'uq_funil_evento_status'`,
  );
  if (indexes.length) {
    await pool.query('ALTER TABLE arrecadacao_funil_etapas DROP INDEX uq_funil_evento_status');
  }

  const [escopoIndex] = await pool.query(
    `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_funil_etapas' AND INDEX_NAME = 'uq_funil_evento_escopo_status'`,
  );
  if (!escopoIndex.length) {
    await pool.query(
      'ALTER TABLE arrecadacao_funil_etapas ADD UNIQUE KEY uq_funil_evento_escopo_status (evento_id, escopo, status)',
    );
  }

  const [statusArrec] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS max_len FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'status'`,
  );
  if (statusArrec[0]?.max_len != null && Number(statusArrec[0].max_len) < 32) {
    await pool.query('ALTER TABLE arrecadacao MODIFY status VARCHAR(32) NOT NULL DEFAULT \'neg\'');
  }
}

export async function listFunilEtapas(pool, eventoId, { escopo = 'comercial' } = {}) {
  const escopoNorm = normalizeFunilEscopo(escopo);
  const [rows] = await pool.query(
    `SELECT id, evento_id, escopo, status, titulo, tipo, cor, ordem, ativo
     FROM arrecadacao_funil_etapas
     WHERE evento_id = ? AND escopo = ?
     ORDER BY ordem ASC, id ASC`,
    [eventoId, escopoNorm],
  );
  if (!rows.length) return defaultEtapasForEscopo(escopoNorm);
  return rows.map(rowToEtapa);
}

export function etapaByStatus(etapas, status) {
  return etapas.find((e) => e.status === status) || null;
}

export function perdaStatuses(etapas) {
  const set = new Set(['perda']);
  for (const e of etapas) {
    if (e.tipo === 'perda') set.add(e.status);
  }
  return set;
}

export function isPerdaStatus(status, etapas) {
  if (status === 'perda') return true;
  return etapas.some((e) => e.tipo === 'perda' && e.status === status);
}

export function perdaEtapa(etapas) {
  return etapas.find((e) => e.tipo === 'perda') || null;
}

export function vendaEtapa(etapas) {
  return etapas.find((e) => e.tipo === 'venda') || null;
}

export async function saveFunilEtapas(pool, eventoId, rawEtapas, { escopo = 'comercial' } = {}) {
  const escopoNorm = normalizeFunilEscopo(escopo);

  if (!Array.isArray(rawEtapas) || rawEtapas.length === 0) {
    throw Object.assign(new Error('Informe ao menos uma etapa do funil'), { status: 400 });
  }

  const usedStatuses = new Set();
  const etapas = rawEtapas.map((raw, index) => normalizeEtapaInput(raw, index, usedStatuses));

  const perdaCount = etapas.filter((e) => e.tipo === 'perda').length;
  const vendaCount = etapas.filter((e) => e.tipo === 'venda').length;
  if (perdaCount > 1) {
    throw Object.assign(new Error('Defina apenas uma etapa do tipo Perda'), { status: 400 });
  }
  if (vendaCount > 1) {
    throw Object.assign(new Error('Defina apenas uma etapa do tipo Venda'), { status: 400 });
  }
  if (!etapas.some((e) => e.ativo)) {
    throw Object.assign(new Error('Mantenha ao menos uma etapa ativa'), { status: 400 });
  }
  if (!etapas.some((e) => e.ativo && e.tipo === 'normal')) {
    throw Object.assign(
      new Error('Mantenha ao menos uma etapa normal ativa para novos leads'),
      { status: 400 },
    );
  }

  etapas.sort((a, b) => a.ordem - b.ordem);
  etapas.forEach((e, i) => {
    e.ordem = i;
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM arrecadacao_funil_etapas WHERE evento_id = ? AND escopo = ?', [
      eventoId,
      escopoNorm,
    ]);
    for (const etapa of etapas) {
      await conn.query(
        `INSERT INTO arrecadacao_funil_etapas
           (evento_id, escopo, status, titulo, tipo, cor, ordem, ativo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          eventoId,
          escopoNorm,
          etapa.status,
          etapa.titulo,
          etapa.tipo,
          etapa.cor,
          etapa.ordem,
          etapa.ativo ? 1 : 0,
        ],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return listFunilEtapas(pool, eventoId, { escopo: escopoNorm });
}

export function labelForStatus(status, etapas) {
  const etapa = etapas.find((e) => e.status === status && e.ativo);
  if (etapa) return etapa.titulo;
  return DEFAULT_LABELS[status] || status;
}
