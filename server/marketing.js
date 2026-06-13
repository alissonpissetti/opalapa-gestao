function parseCanalIds(row) {
  if (!row.canal_ids) return [];
  return String(row.canal_ids)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseCanalNomes(row) {
  if (!row.canal_nomes) return [];
  return String(row.canal_nomes)
    .split(' · ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowToCanal(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    nome: row.nome,
    ativo: Boolean(row.ativo),
    ordem: Number(row.ordem),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function rowToCampanha(row) {
  const canalIds = parseCanalIds(row);
  const canalNomes = parseCanalNomes(row);
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    canalIds,
    /** @deprecated use canalIds — primeiro id, só compatibilidade */
    canalId: canalIds[0] ?? null,
    canalNome: canalNomes.join(' · ') || '',
    canalNomes,
    nome: row.nome,
    ativo: Boolean(row.ativo),
    ordem: Number(row.ordem),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function rowToCriativo(row) {
  const canalIdsProprios = parseCanalIds({ canal_ids: row.criativo_canal_ids });
  const campanhaCanalIds = parseCanalIds({ canal_ids: row.campanha_canal_ids });
  const origensDaCampanha = canalIdsProprios.length === 0;
  const canalIds = origensDaCampanha ? campanhaCanalIds : canalIdsProprios;
  const canalNomes = origensDaCampanha
    ? parseCanalNomes({ canal_nomes: row.campanha_canal_nomes })
    : parseCanalNomes({ canal_nomes: row.criativo_canal_nomes });
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    campanhaId: Number(row.campanha_id),
    campanhaNome: row.campanha_nome || '',
    canalIds,
    canalIdsProprios,
    campanhaCanalIds,
    origensDaCampanha,
    canalId: canalIds[0] ?? null,
    canalNome: canalNomes.join(' · ') || '',
    canalNomes,
    nome: row.nome,
    ativo: Boolean(row.ativo),
    ordem: Number(row.ordem),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

const CAMPANHA_SELECT = `
  SELECT c.id, c.evento_id, c.nome, c.ativo, c.ordem, c.created_at,
         GROUP_CONCAT(DISTINCT mc.id ORDER BY mc.ordem ASC, mc.nome ASC, mc.id ASC SEPARATOR ',') AS canal_ids,
         GROUP_CONCAT(DISTINCT mc.nome ORDER BY mc.ordem ASC, mc.nome ASC, mc.id ASC SEPARATOR ' · ') AS canal_nomes
  FROM marketing_campanhas c
  LEFT JOIN marketing_campanha_canais mcc ON mcc.campanha_id = c.id
  LEFT JOIN marketing_canais mc ON mc.id = mcc.canal_id
`;

const CRIATIVO_SELECT = `
  SELECT cr.id, cr.evento_id, cr.campanha_id, cr.nome, cr.ativo, cr.ordem, cr.created_at,
         cp.nome AS campanha_nome,
         (
           SELECT GROUP_CONCAT(DISTINCT mc2.id ORDER BY mc2.ordem ASC, mc2.nome ASC, mc2.id ASC SEPARATOR ',')
           FROM marketing_criativo_canais crcc
           JOIN marketing_canais mc2 ON mc2.id = crcc.canal_id
           WHERE crcc.criativo_id = cr.id
         ) AS criativo_canal_ids,
         (
           SELECT GROUP_CONCAT(DISTINCT mc2.nome ORDER BY mc2.ordem ASC, mc2.nome ASC, mc2.id ASC SEPARATOR ' · ')
           FROM marketing_criativo_canais crcc
           JOIN marketing_canais mc2 ON mc2.id = crcc.canal_id
           WHERE crcc.criativo_id = cr.id
         ) AS criativo_canal_nomes,
         (
           SELECT GROUP_CONCAT(DISTINCT mc3.id ORDER BY mc3.ordem ASC, mc3.nome ASC, mc3.id ASC SEPARATOR ',')
           FROM marketing_campanha_canais mcc
           JOIN marketing_canais mc3 ON mc3.id = mcc.canal_id
           WHERE mcc.campanha_id = cr.campanha_id
         ) AS campanha_canal_ids,
         (
           SELECT GROUP_CONCAT(DISTINCT mc3.nome ORDER BY mc3.ordem ASC, mc3.nome ASC, mc3.id ASC SEPARATOR ' · ')
           FROM marketing_campanha_canais mcc
           JOIN marketing_canais mc3 ON mc3.id = mcc.canal_id
           WHERE mcc.campanha_id = cr.campanha_id
         ) AS campanha_canal_nomes
  FROM marketing_criativos cr
  JOIN marketing_campanhas cp ON cp.id = cr.campanha_id
`;

function normalizeCanalIds(raw) {
  const fromArray = Array.isArray(raw.canalIds)
    ? raw.canalIds
    : Array.isArray(raw.canal_ids)
      ? raw.canal_ids
      : null;
  if (fromArray) {
    return [...new Set(fromArray.map((id) => Number(id)).filter((id) => id > 0))];
  }
  const single = Number(raw.canalId ?? raw.canal_id);
  return single > 0 ? [single] : [];
}

async function setCampanhaCanais(pool, campanhaId, canalIds) {
  await pool.query('DELETE FROM marketing_campanha_canais WHERE campanha_id = ?', [campanhaId]);
  for (const canalId of canalIds) {
    await pool.query(
      'INSERT INTO marketing_campanha_canais (campanha_id, canal_id) VALUES (?, ?)',
      [campanhaId, canalId],
    );
  }
}

async function setCriativoCanais(pool, criativoId, canalIds) {
  await pool.query('DELETE FROM marketing_criativo_canais WHERE criativo_id = ?', [criativoId]);
  for (const canalId of canalIds) {
    await pool.query(
      'INSERT INTO marketing_criativo_canais (criativo_id, canal_id) VALUES (?, ?)',
      [criativoId, canalId],
    );
  }
}

async function getCampanhaCanalIds(pool, campanhaId) {
  const [rows] = await pool.query(
    `SELECT canal_id FROM marketing_campanha_canais
     WHERE campanha_id = ?
     ORDER BY canal_id ASC`,
    [campanhaId],
  );
  return rows.map((r) => Number(r.canal_id)).filter((id) => id > 0);
}

function sameIdSet(a, b) {
  const sa = [...new Set(a.map(Number))].sort((x, y) => x - y);
  const sb = [...new Set(b.map(Number))].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((id, i) => id === sb[i]);
}

async function resolveCriativoOrigens(pool, campanhaId, raw) {
  const campanhaCanalIds = await getCampanhaCanalIds(pool, campanhaId);
  const usarCampanha =
    raw.usarOrigensCampanha === true ||
    raw.usar_origens_campanha === true ||
    raw.usarOrigensCampanha === 'true';
  const explicit = normalizeCanalIds(raw);

  if (usarCampanha || !explicit.length || sameIdSet(explicit, campanhaCanalIds)) {
    return { inherit: true, canalIds: campanhaCanalIds };
  }
  if (!explicit.length) {
    throw Object.assign(new Error('Selecione ao menos uma origem'), { status: 400 });
  }
  return { inherit: false, canalIds: explicit };
}

export async function migrateMarketing(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_canais (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(120) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      ordem INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_marketing_canais_evento (evento_id),
      CONSTRAINT fk_marketing_canais_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_campanhas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(120) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      ordem INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_marketing_campanhas_evento (evento_id),
      CONSTRAINT fk_marketing_campanhas_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_campanha_canais (
      campanha_id INT UNSIGNED NOT NULL,
      canal_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (campanha_id, canal_id),
      INDEX idx_mcc_canal (canal_id),
      CONSTRAINT fk_mcc_campanha FOREIGN KEY (campanha_id) REFERENCES marketing_campanhas(id) ON DELETE CASCADE,
      CONSTRAINT fk_mcc_canal FOREIGN KEY (canal_id) REFERENCES marketing_canais(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_criativos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      campanha_id INT UNSIGNED NOT NULL,
      nome VARCHAR(120) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      ordem INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_marketing_criativos_evento (evento_id),
      INDEX idx_marketing_criativos_campanha (campanha_id),
      CONSTRAINT fk_marketing_criativos_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
      CONSTRAINT fk_marketing_criativos_campanha FOREIGN KEY (campanha_id) REFERENCES marketing_campanhas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_criativo_canais (
      criativo_id INT UNSIGNED NOT NULL,
      canal_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (criativo_id, canal_id),
      INDEX idx_mcr_canal (canal_id),
      CONSTRAINT fk_mcr_criativo FOREIGN KEY (criativo_id) REFERENCES marketing_criativos(id) ON DELETE CASCADE,
      CONSTRAINT fk_mcr_canal FOREIGN KEY (canal_id) REFERENCES marketing_canais(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [campanhaCols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketing_campanhas'`,
  );
  const campanhaColSet = new Set(campanhaCols.map((c) => c.name));
  if (campanhaColSet.has('canal_id')) {
    await pool.query(`
      INSERT IGNORE INTO marketing_campanha_canais (campanha_id, canal_id)
      SELECT id, canal_id FROM marketing_campanhas WHERE canal_id IS NOT NULL
    `);
    const [fks] = await pool.query(
      `SELECT CONSTRAINT_NAME AS name FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketing_campanhas'
         AND COLUMN_NAME = 'canal_id' AND REFERENCED_TABLE_NAME IS NOT NULL`,
    );
    for (const fk of fks) {
      await pool.query(`ALTER TABLE marketing_campanhas DROP FOREIGN KEY \`${fk.name}\``);
    }
    await pool.query('ALTER TABLE marketing_campanhas DROP COLUMN canal_id');
  }

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao'`,
  );
  const colSet = new Set(cols.map((c) => c.name));
  if (!colSet.has('marketing_canal_id')) {
    await pool.query(
      'ALTER TABLE arrecadacao ADD COLUMN marketing_canal_id INT UNSIGNED NULL AFTER obs',
    );
  }
  if (!colSet.has('marketing_campanha_id')) {
    await pool.query(
      'ALTER TABLE arrecadacao ADD COLUMN marketing_campanha_id INT UNSIGNED NULL AFTER marketing_canal_id',
    );
  }
  if (!colSet.has('marketing_criativo_id')) {
    await pool.query(
      'ALTER TABLE arrecadacao ADD COLUMN marketing_criativo_id INT UNSIGNED NULL AFTER marketing_campanha_id',
    );
  }
}

export async function listMarketingCanais(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT id, evento_id, nome, ativo, ordem, created_at
     FROM marketing_canais
     WHERE evento_id = ?
     ORDER BY ordem ASC, nome ASC, id ASC`,
    [eventoId],
  );
  return rows.map(rowToCanal);
}

export async function listMarketingCampanhas(pool, eventoId, { canalId } = {}) {
  const params = [eventoId];
  let where = 'WHERE c.evento_id = ?';
  if (canalId != null) {
    where += ` AND EXISTS (
      SELECT 1 FROM marketing_campanha_canais mccf
      WHERE mccf.campanha_id = c.id AND mccf.canal_id = ?
    )`;
    params.push(Number(canalId));
  }
  const [rows] = await pool.query(
    `${CAMPANHA_SELECT}
     ${where}
     GROUP BY c.id
     ORDER BY c.ordem ASC, c.nome ASC, c.id ASC`,
    params,
  );
  return rows.map(rowToCampanha);
}

export async function listMarketingCriativos(pool, eventoId, { campanhaId, canalId } = {}) {
  const params = [eventoId];
  let where = 'WHERE cr.evento_id = ?';
  if (campanhaId != null) {
    where += ' AND cr.campanha_id = ?';
    params.push(Number(campanhaId));
  }
  if (canalId != null) {
    where += ` AND (
      EXISTS (
        SELECT 1 FROM marketing_criativo_canais crccf
        WHERE crccf.criativo_id = cr.id AND crccf.canal_id = ?
      )
      OR (
        NOT EXISTS (SELECT 1 FROM marketing_criativo_canais crccf2 WHERE crccf2.criativo_id = cr.id)
        AND EXISTS (
          SELECT 1 FROM marketing_campanha_canais mccf
          WHERE mccf.campanha_id = cr.campanha_id AND mccf.canal_id = ?
        )
      )
    )`;
    params.push(Number(canalId), Number(canalId));
  }
  const [rows] = await pool.query(
    `${CRIATIVO_SELECT}
     ${where}
     ORDER BY cr.ordem ASC, cr.nome ASC, cr.id ASC`,
    params,
  );
  return rows.map(rowToCriativo);
}

export async function listMarketingTree(pool, eventoId) {
  const canais = await listMarketingCanais(pool, eventoId);
  const campanhas = await listMarketingCampanhas(pool, eventoId);
  const criativos = await listMarketingCriativos(pool, eventoId);
  return { canais, campanhas, criativos };
}

async function nextOrdem(pool, table, eventoId, extraWhere = '', extraParams = []) {
  const [rows] = await pool.query(
    `SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem FROM ${table}
     WHERE evento_id = ?${extraWhere}`,
    [eventoId, ...extraParams],
  );
  return Number(rows[0]?.next_ordem) || 0;
}

export async function createMarketingCanal(pool, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome da origem'), { status: 400 });
  const ordem = await nextOrdem(pool, 'marketing_canais', eventoId);
  const [result] = await pool.query(
    `INSERT INTO marketing_canais (evento_id, nome, ordem, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [eventoId, nome, ordem],
  );
  const [rows] = await pool.query(
    'SELECT id, evento_id, nome, ativo, ordem, created_at FROM marketing_canais WHERE id = ?',
    [result.insertId],
  );
  return rows[0] ? rowToCanal(rows[0]) : null;
}

export async function createMarketingCampanha(pool, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  const canalIds = normalizeCanalIds(raw);
  if (!nome) throw Object.assign(new Error('Informe o nome da campanha'), { status: 400 });
  if (!canalIds.length) {
    throw Object.assign(new Error('Selecione ao menos uma origem'), { status: 400 });
  }
  const ordem = await nextOrdem(pool, 'marketing_campanhas', eventoId);
  const [result] = await pool.query(
    `INSERT INTO marketing_campanhas (evento_id, nome, ordem, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [eventoId, nome, ordem],
  );
  const campanhaId = result.insertId;
  await setCampanhaCanais(pool, campanhaId, canalIds);
  const campanhas = await listMarketingCampanhas(pool, eventoId);
  return campanhas.find((c) => c.id === campanhaId) || null;
}

export async function createMarketingCriativo(pool, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  const campanhaId = Number(raw.campanhaId ?? raw.campanha_id);
  if (!nome) throw Object.assign(new Error('Informe o nome do criativo'), { status: 400 });
  if (!campanhaId) throw Object.assign(new Error('Selecione a campanha'), { status: 400 });
  const { inherit, canalIds } = await resolveCriativoOrigens(pool, campanhaId, raw);
  const ordem = await nextOrdem(pool, 'marketing_criativos', eventoId, ' AND campanha_id = ?', [
    campanhaId,
  ]);
  const [result] = await pool.query(
    `INSERT INTO marketing_criativos (evento_id, campanha_id, nome, ordem, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [eventoId, campanhaId, nome, ordem],
  );
  const criativoId = result.insertId;
  if (!inherit) {
    await setCriativoCanais(pool, criativoId, canalIds);
  }
  const list = await listMarketingCriativos(pool, eventoId);
  return list.find((c) => c.id === criativoId) || null;
}

export async function updateMarketingCanal(pool, id, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome da origem'), { status: 400 });
  const [result] = await pool.query(
    `UPDATE marketing_canais SET nome = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [nome, raw.ativo === false ? 0 : 1, id, eventoId],
  );
  if (result.affectedRows === 0) return null;
  const canais = await listMarketingCanais(pool, eventoId);
  return canais.find((c) => c.id === Number(id)) || null;
}

export async function updateMarketingCampanha(pool, id, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  const canalIds = normalizeCanalIds(raw);
  if (!nome) throw Object.assign(new Error('Informe o nome da campanha'), { status: 400 });
  if (!canalIds.length) {
    throw Object.assign(new Error('Selecione ao menos uma origem'), { status: 400 });
  }
  const [result] = await pool.query(
    `UPDATE marketing_campanhas SET nome = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [nome, raw.ativo === false ? 0 : 1, id, eventoId],
  );
  if (result.affectedRows === 0) return null;
  await setCampanhaCanais(pool, id, canalIds);
  const campanhas = await listMarketingCampanhas(pool, eventoId);
  return campanhas.find((c) => c.id === Number(id)) || null;
}

export async function updateMarketingCriativo(pool, id, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  const campanhaId = Number(raw.campanhaId ?? raw.campanha_id);
  if (!nome) throw Object.assign(new Error('Informe o nome do criativo'), { status: 400 });
  if (!campanhaId) throw Object.assign(new Error('Selecione a campanha'), { status: 400 });
  const { inherit, canalIds } = await resolveCriativoOrigens(pool, campanhaId, raw);
  const [result] = await pool.query(
    `UPDATE marketing_criativos SET nome = ?, campanha_id = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [nome, campanhaId, raw.ativo === false ? 0 : 1, id, eventoId],
  );
  if (result.affectedRows === 0) return null;
  if (inherit) {
    await pool.query('DELETE FROM marketing_criativo_canais WHERE criativo_id = ?', [id]);
  } else {
    await setCriativoCanais(pool, id, canalIds);
  }
  const criativos = await listMarketingCriativos(pool, eventoId);
  return criativos.find((c) => c.id === Number(id)) || null;
}

export async function deleteMarketingCanal(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM marketing_canais WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function deleteMarketingCampanha(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM marketing_campanhas WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function deleteMarketingCriativo(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM marketing_criativos WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}
