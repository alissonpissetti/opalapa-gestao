const RANKING_SELECT = `
  SELECT id, evento_id, posicao, nome, pontos, tempo, veiculo, created_at, updated_at
  FROM stock_experience_ranking
`;

const SEED_ENTRIES = [
  { posicao: 1, nome: 'Carlos "Turbo" Mendes', pontos: 248, tempo: '1:38.420', veiculo: 'Opala SS 1978' },
  { posicao: 2, nome: 'Ricardo "Laranja" Silva', pontos: 235, tempo: '1:39.105', veiculo: 'Opala Diplomata 1976' },
  { posicao: 3, nome: 'Fernando Stock', pontos: 221, tempo: '1:40.880', veiculo: 'Opala Gran Luxo 1974' },
  { posicao: 4, nome: 'Paulo "Pista" Rocha', pontos: 208, tempo: '1:41.220', veiculo: 'Opala Comodoro 1979' },
  { posicao: 5, nome: 'Marcos Interlagos', pontos: 195, tempo: '1:42.015', veiculo: 'Opala SS 1977' },
  { posicao: 6, nome: 'Júlio "Asa" Campos', pontos: 182, tempo: '1:43.340', veiculo: 'Opala Especial 1975' },
  { posicao: 7, nome: 'André Bandeira', pontos: 170, tempo: '1:44.900', veiculo: 'Opala Caravan 1978' },
  { posicao: 8, nome: 'Vitor "Xadrez" Lima', pontos: 158, tempo: '1:45.610', veiculo: 'Opala SS 1973' },
];

function rowToItem(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    posicao: Number(row.posicao),
    nome: row.nome,
    pontos: Number(row.pontos),
    tempo: row.tempo || '',
    veiculo: row.veiculo || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeEntry(raw, index = 0) {
  const nome = String(raw.nome ?? '').trim();
  if (!nome) {
    throw Object.assign(new Error(`Informe o nome do piloto (posição ${index + 1})`), { status: 400 });
  }

  const posicao = Number(raw.posicao ?? index + 1);
  if (!Number.isInteger(posicao) || posicao < 1) {
    throw Object.assign(new Error(`Posição inválida na linha ${index + 1}`), { status: 400 });
  }

  const pontos = Number(raw.pontos ?? 0);
  if (!Number.isFinite(pontos) || pontos < 0) {
    throw Object.assign(new Error(`Pontuação inválida na linha ${index + 1}`), { status: 400 });
  }

  const tempo = String(raw.tempo ?? '').trim() || null;
  const veiculo = String(raw.veiculo ?? '').trim() || null;

  return { posicao, nome, pontos: Math.round(pontos), tempo, veiculo };
}

export async function migrateStockExperienceRanking(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_experience_ranking (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      posicao SMALLINT UNSIGNED NOT NULL,
      nome VARCHAR(120) NOT NULL,
      pontos INT UNSIGNED NOT NULL DEFAULT 0,
      tempo VARCHAR(20) NULL,
      veiculo VARCHAR(80) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_stock_ranking_evento_pos (evento_id, posicao),
      INDEX idx_stock_ranking_evento (evento_id),
      CONSTRAINT fk_stock_ranking_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function resolveDefaultEventoId(pool) {
  const [rows] = await pool.query('SELECT id FROM eventos ORDER BY edicao DESC LIMIT 1');
  return rows[0]?.id ? Number(rows[0].id) : null;
}

async function seedRankingIfEmpty(pool, eventoId) {
  const [existing] = await pool.query(
    'SELECT id FROM stock_experience_ranking WHERE evento_id = ? LIMIT 1',
    [eventoId],
  );
  if (existing.length > 0) return;

  for (const entry of SEED_ENTRIES) {
    await pool.query(
      `INSERT INTO stock_experience_ranking (evento_id, posicao, nome, pontos, tempo, veiculo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [eventoId, entry.posicao, entry.nome, entry.pontos, entry.tempo, entry.veiculo],
    );
  }
}

export async function listStockExperienceRanking(pool, eventoId, { seedIfEmpty = true } = {}) {
  if (!eventoId) {
    eventoId = await resolveDefaultEventoId(pool);
  }
  if (!eventoId) {
    return { eventoId: null, eventoNome: '', items: [] };
  }

  if (seedIfEmpty) {
    await seedRankingIfEmpty(pool, eventoId);
  }

  const [eventoRows] = await pool.query('SELECT id, nome, edicao FROM eventos WHERE id = ? LIMIT 1', [
    eventoId,
  ]);
  const evento = eventoRows[0];

  const [rows] = await pool.query(
    `${RANKING_SELECT}
     WHERE evento_id = ?
     ORDER BY posicao ASC`,
    [eventoId],
  );

  return {
    eventoId,
    eventoNome: evento?.nome || '',
    eventoEdicao: evento?.edicao != null ? Number(evento.edicao) : null,
    items: rows.map(rowToItem),
  };
}

export async function replaceStockExperienceRanking(pool, eventoId, rawItems) {
  if (!Array.isArray(rawItems)) {
    throw Object.assign(new Error('Envie uma lista de pilotos'), { status: 400 });
  }

  const items = rawItems.map((item, index) => normalizeEntry(item, index));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM stock_experience_ranking WHERE evento_id = ?', [eventoId]);

    for (const item of items) {
      await conn.query(
        `INSERT INTO stock_experience_ranking (evento_id, posicao, nome, pontos, tempo, veiculo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [eventoId, item.posicao, item.nome, item.pontos, item.tempo, item.veiculo],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return listStockExperienceRanking(pool, eventoId, { seedIfEmpty: false });
}
