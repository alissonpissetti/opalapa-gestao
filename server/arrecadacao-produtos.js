export const BENEFICIOS_DEF = [
  {
    key: 'mencao_materiais_online',
    label: 'Menção em Materiais Veículados Online',
  },
  {
    key: 'logo_camisetas',
    label: 'Logo aplicada a camisetas',
  },
  {
    key: 'logo_ecocopo',
    label: 'Logo aplicada ao ecocopo',
    limiteConfirmados: 6,
    limiteHint: 'Limitado aos 6 primeiros confirmados',
  },
  {
    key: 'marca_site',
    label: 'Marca no site oficial',
    universal: true,
  },
  {
    key: 'marca_aftermovie',
    label: 'Marca no aftermovie',
  },
  {
    key: 'post_redes',
    label: '1 post criativo nas redes do evento',
  },
  {
    key: 'kit_participacao',
    label: 'Item no kit de participação',
  },
  {
    key: 'logo_trofeu',
    label: 'Logo aplicada ao troféu de premiados',
    limiteConfirmados: 5,
    limiteHint: 'Limitada aos 5 primeiros confirmados',
  },
];

export const ESPACOS_TIPOS_PADRAO = [
  '3x3',
  '4x3',
  '5x5',
  '5x5 c/fec',
  '5x5 s/fec',
  '5x5 balcão',
  '6x3',
  '6x6',
  '9x3',
  '14x3',
  'Tenda 5x5',
  'Tenda 10x5',
];

/** Benefícios incluídos em todos os planos — não podem ser desativados por cota. */
export const BENEFICIOS_UNIVERSAIS = BENEFICIOS_DEF.filter((b) => b.universal).map((b) => b.key);

const BENEFICIO_KEYS = new Set(BENEFICIOS_DEF.map((b) => b.key));
const UNIVERSAL_BENEFICIO_KEYS = new Set(BENEFICIOS_UNIVERSAIS);

function applyBeneficiosUniversais(beneficios) {
  const out = { ...beneficios };
  for (const key of BENEFICIOS_UNIVERSAIS) {
    out[key] = true;
  }
  return out;
}

const DEFAULT_PRODUTOS = [
  {
    nome: 'Bronze',
    ordem: 0,
    descricao: 'Cota básica de patrocínio',
    espacosTipos: ['3x3'],
    beneficios: {
      mencao_materiais_online: true,
      marca_site: true,
      kit_participacao: true,
    },
  },
  {
    nome: 'Prata',
    ordem: 1,
    descricao: 'Cota intermediária de patrocínio',
    espacosTipos: ['3x3', '4x3', '5x5'],
    beneficios: {
      mencao_materiais_online: true,
      marca_site: true,
      kit_participacao: true,
      logo_camisetas: true,
      post_redes: true,
    },
  },
  {
    nome: 'Ouro',
    ordem: 2,
    descricao: 'Cota premium de patrocínio',
    espacosTipos: ['3x3', '4x3', '5x5', '9x3'],
    beneficios: {
      mencao_materiais_online: true,
      logo_camisetas: true,
      logo_ecocopo: true,
      marca_site: true,
      marca_aftermovie: true,
      post_redes: true,
      kit_participacao: true,
      logo_trofeu: true,
    },
  },
];

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

function parseJsonArray(value, fallback = []) {
  if (value == null || value === '') return [...fallback];
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [...fallback];
    } catch {
      return [...fallback];
    }
  }
  return [...fallback];
}

function normalizeBeneficios(raw) {
  const input = parseJsonObject(raw);
  const out = {};
  for (const key of BENEFICIO_KEYS) {
    out[key] = Boolean(input[key]);
  }
  return applyBeneficiosUniversais(out);
}

function parseValorMoney(value, label = 'Valor') {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) {
    throw Object.assign(new Error(`${label} inválido`), { status: 400 });
  }
  return Math.round(n * 100) / 100;
}

function normalizeEspacosTipos(raw) {
  const arr = parseJsonArray(raw);
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const tipo = String(item || '').trim();
    if (!tipo || seen.has(tipo)) continue;
    seen.add(tipo);
    out.push(tipo);
  }
  return out;
}

function rowToProduto(row) {
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    nome: row.nome || '',
    descricao: row.descricao || '',
    valor: row.valor != null ? Number(row.valor) : 0,
    ordem: Number(row.ordem) || 0,
    ativo: Boolean(row.ativo),
    beneficios: normalizeBeneficios(row.beneficios),
    espacosTipos: normalizeEspacosTipos(row.espacos_tipos),
    usoLeads: Number(row.uso_leads) || 0,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function migrateArrecadacaoProdutos(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arrecadacao_produtos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(80) NOT NULL,
      descricao VARCHAR(255) NOT NULL DEFAULT '',
      valor DECIMAL(14,2) NOT NULL DEFAULT 0,
      ordem INT NOT NULL DEFAULT 0,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      beneficios JSON NOT NULL,
      espacos_tipos JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_arrec_prod_evento_nome (evento_id, nome),
      INDEX idx_arrec_prod_evento (evento_id),
      CONSTRAINT fk_arrec_prod_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [valorCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao_produtos' AND COLUMN_NAME = 'valor'`,
  );
  if (valorCol.length === 0) {
    await pool.query(`
      ALTER TABLE arrecadacao_produtos
        ADD COLUMN valor DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER descricao
    `);
  }

  const [prodCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'produto_id'`,
  );
  if (prodCol.length === 0) {
    await pool.query(`
      ALTER TABLE arrecadacao
        ADD COLUMN produto_id INT UNSIGNED NULL AFTER espaco_id,
        ADD INDEX idx_arrecadacao_produto (produto_id),
        ADD CONSTRAINT fk_arrecadacao_produto
          FOREIGN KEY (produto_id) REFERENCES arrecadacao_produtos(id) ON DELETE SET NULL
    `);
  }

  await ensureUniversalBeneficiosOnExistingPlans(pool);
}

async function ensureUniversalBeneficiosOnExistingPlans(pool) {
  if (!BENEFICIOS_UNIVERSAIS.length) return;
  const [rows] = await pool.query('SELECT id, beneficios FROM arrecadacao_produtos');
  for (const row of rows) {
    const current = parseJsonObject(row.beneficios);
    const normalized = normalizeBeneficios(current);
    const needsUpdate = BENEFICIOS_UNIVERSAIS.some((key) => !current[key]);
    if (needsUpdate) {
      await pool.query('UPDATE arrecadacao_produtos SET beneficios = ? WHERE id = ?', [
        JSON.stringify(normalized),
        row.id,
      ]);
    }
  }
}

async function ensureDefaultProdutos(pool, eventoId) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM arrecadacao_produtos WHERE evento_id = ?',
    [eventoId],
  );
  if (Number(rows[0]?.n || 0) > 0) return;

  for (const seed of DEFAULT_PRODUTOS) {
    await pool.query(
      `INSERT INTO arrecadacao_produtos
         (evento_id, nome, descricao, valor, ordem, ativo, beneficios, espacos_tipos, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        eventoId,
        seed.nome,
        seed.descricao,
        parseValorMoney(seed.valor ?? 0),
        seed.ordem,
        JSON.stringify(normalizeBeneficios(seed.beneficios)),
        JSON.stringify(normalizeEspacosTipos(seed.espacosTipos)),
      ],
    );
  }
}

export async function listEspacosTiposDisponiveis(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT TRIM(e.tipo) AS tipo
     FROM espacos e
     JOIN grupos_espacos g ON g.id = e.grupo_id
     WHERE g.evento_id = ? AND TRIM(e.tipo) != ''
     ORDER BY tipo ASC`,
    [eventoId],
  );
  const seen = new Set(ESPACOS_TIPOS_PADRAO);
  const merged = [...ESPACOS_TIPOS_PADRAO];
  for (const row of rows) {
    const tipo = String(row.tipo || '').trim();
    if (tipo && !seen.has(tipo)) {
      seen.add(tipo);
      merged.push(tipo);
    }
  }
  return merged;
}

const PRODUTO_SELECT = `
  SELECT p.id, p.evento_id, p.nome, p.descricao, p.valor, p.ordem, p.ativo,
         p.beneficios, p.espacos_tipos, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM arrecadacao a WHERE a.produto_id = p.id) AS uso_leads
  FROM arrecadacao_produtos p`;

export async function listArrecadacaoProdutos(pool, eventoId, { gestao = false } = {}) {
  await ensureDefaultProdutos(pool, eventoId);
  const ativoClause = gestao ? '' : ' AND p.ativo = 1';
  const [rows] = await pool.query(
    `${PRODUTO_SELECT}
     WHERE p.evento_id = ?${ativoClause}
     ORDER BY p.ordem ASC, p.nome ASC`,
    [eventoId],
  );
  const espacosTipos = await listEspacosTiposDisponiveis(pool, eventoId);
  return {
    produtos: rows.map(rowToProduto),
    beneficiosDef: BENEFICIOS_DEF,
    beneficiosUniversais: BENEFICIOS_UNIVERSAIS,
    espacosTipos,
  };
}

export async function findArrecadacaoProdutoById(pool, id, eventoId) {
  const [rows] = await pool.query(`${PRODUTO_SELECT} WHERE p.id = ? AND p.evento_id = ? LIMIT 1`, [
    id,
    eventoId,
  ]);
  return rows[0] ? rowToProduto(rows[0]) : null;
}

async function resolveProdutoId(pool, eventoId, raw) {
  if (raw.produtoId === undefined && raw.produto_id === undefined) return undefined;
  const v = raw.produtoId ?? raw.produto_id;
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) {
    throw Object.assign(new Error('Plano de patrocínio inválido'), { status: 400 });
  }
  const produto = await findArrecadacaoProdutoById(pool, id, eventoId);
  if (!produto) {
    throw Object.assign(new Error('Plano de patrocínio não encontrado neste evento'), { status: 400 });
  }
  if (!produto.ativo) {
    throw Object.assign(new Error('Este plano está inativo'), { status: 400 });
  }
  return id;
}

export { resolveProdutoId };

export async function createArrecadacaoProduto(pool, eventoId, raw) {
  await ensureDefaultProdutos(pool, eventoId);
  const nome = String(raw.nome ?? '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome do plano'), { status: 400 });

  const [existing] = await pool.query(
    `SELECT id, ativo FROM arrecadacao_produtos
     WHERE evento_id = ? AND LOWER(nome) = LOWER(?)
     LIMIT 1`,
    [eventoId, nome],
  );
  if (existing[0]) {
    if (!Number(existing[0].ativo)) {
      const updated = await updateArrecadacaoProduto(pool, existing[0].id, eventoId, {
        ...raw,
        ativo: true,
      });
      return updated;
    }
    throw Object.assign(new Error('Já existe um plano com este nome'), { status: 400 });
  }

  const descricao = String(raw.descricao ?? '').trim();
  const beneficios = normalizeBeneficios(raw.beneficios);
  const espacosTipos = normalizeEspacosTipos(raw.espacosTipos ?? raw.espacos_tipos);
  const ativo = raw.ativo === false || raw.ativo === 0 ? 0 : 1;
  const valor = parseValorMoney(raw.valor ?? 0);

  let ordem = raw.ordem != null ? Number(raw.ordem) : null;
  if (ordem == null || Number.isNaN(ordem)) {
    const [maxOrd] = await pool.query(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem FROM arrecadacao_produtos WHERE evento_id = ?',
      [eventoId],
    );
    ordem = Number(maxOrd[0]?.next_ordem) || 0;
  }

  const [result] = await pool.query(
    `INSERT INTO arrecadacao_produtos
       (evento_id, nome, descricao, valor, ordem, ativo, beneficios, espacos_tipos, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      nome,
      descricao,
      valor,
      ordem,
      ativo,
      JSON.stringify(beneficios),
      JSON.stringify(espacosTipos),
    ],
  );
  return findArrecadacaoProdutoById(pool, result.insertId, eventoId);
}

export async function updateArrecadacaoProduto(pool, id, eventoId, raw) {
  const existing = await findArrecadacaoProdutoById(pool, id, eventoId);
  if (!existing) return null;

  const nome = raw.nome !== undefined ? String(raw.nome ?? '').trim() : existing.nome;
  if (!nome) throw Object.assign(new Error('Informe o nome do plano'), { status: 400 });

  if (nome.toLowerCase() !== existing.nome.toLowerCase()) {
    const [dup] = await pool.query(
      `SELECT id FROM arrecadacao_produtos
       WHERE evento_id = ? AND LOWER(nome) = LOWER(?) AND id != ?
       LIMIT 1`,
      [eventoId, nome, id],
    );
    if (dup[0]) {
      throw Object.assign(new Error('Já existe um plano com este nome'), { status: 400 });
    }
  }

  const descricao = raw.descricao !== undefined ? String(raw.descricao ?? '').trim() : existing.descricao;
  const valor = raw.valor !== undefined ? parseValorMoney(raw.valor) : existing.valor;
  const beneficios =
    raw.beneficios !== undefined ? normalizeBeneficios(raw.beneficios) : existing.beneficios;
  const espacosTipos =
    raw.espacosTipos !== undefined || raw.espacos_tipos !== undefined
      ? normalizeEspacosTipos(raw.espacosTipos ?? raw.espacos_tipos)
      : existing.espacosTipos;
  const ativo =
    raw.ativo !== undefined ? (raw.ativo === false || raw.ativo === 0 ? 0 : 1) : existing.ativo ? 1 : 0;
  const ordem = raw.ordem !== undefined ? Number(raw.ordem) || 0 : existing.ordem;

  await pool.query(
    `UPDATE arrecadacao_produtos SET
       nome = ?, descricao = ?, valor = ?, ordem = ?, ativo = ?,
       beneficios = ?, espacos_tipos = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      nome,
      descricao,
      valor,
      ordem,
      ativo,
      JSON.stringify(beneficios),
      JSON.stringify(espacosTipos),
      id,
      eventoId,
    ],
  );
  return findArrecadacaoProdutoById(pool, id, eventoId);
}

async function resolveDuplicateNome(pool, eventoId, baseNome) {
  const candidates = [`${baseNome} (cópia)`];
  for (let i = 2; i <= 99; i += 1) {
    candidates.push(`${baseNome} ${i}`);
  }
  for (const nome of candidates) {
    const [existing] = await pool.query(
      `SELECT id FROM arrecadacao_produtos
       WHERE evento_id = ? AND LOWER(nome) = LOWER(?)
       LIMIT 1`,
      [eventoId, nome],
    );
    if (!existing[0]) return nome;
  }
  throw Object.assign(new Error('Não foi possível gerar nome único para a cópia'), { status: 400 });
}

export async function duplicateArrecadacaoProduto(pool, id, eventoId) {
  const source = await findArrecadacaoProdutoById(pool, id, eventoId);
  if (!source) return null;

  const nome = await resolveDuplicateNome(pool, eventoId, source.nome);
  const [maxOrd] = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem FROM arrecadacao_produtos WHERE evento_id = ?',
    [eventoId],
  );
  const ordem = Number(maxOrd[0]?.next_ordem) || 0;

  return createArrecadacaoProduto(pool, eventoId, {
    nome,
    descricao: source.descricao,
    valor: source.valor,
    ordem,
    ativo: true,
    beneficios: source.beneficios,
    espacosTipos: source.espacosTipos,
  });
}

export async function deleteArrecadacaoProduto(pool, id, eventoId) {
  const existing = await findArrecadacaoProdutoById(pool, id, eventoId);
  if (!existing) return false;

  const [uso] = await pool.query(
    'SELECT COUNT(*) AS n FROM arrecadacao WHERE produto_id = ?',
    [id],
  );
  if (Number(uso[0]?.n || 0) > 0) {
    throw Object.assign(
      new Error('Não é possível excluir: há patrocinadores vinculados a este plano'),
      { status: 400 },
    );
  }

  const [result] = await pool.query(
    'DELETE FROM arrecadacao_produtos WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}
