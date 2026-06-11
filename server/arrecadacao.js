import { ensureParticipante } from './participantes.js';

const ACTIVE_STATUS = new Set(['neg', 'res', 'vend']);

function rowToArrecadacao(row) {
  const valorTotal = Number(row.valor_total);
  const valorPago = Number(row.valor_pago);
  return {
    id: row.id,
    participanteId: row.participante_id,
    participanteNome: row.participante_nome || '',
    tipo: row.tipo,
    espacoId: row.espaco_id != null ? Number(row.espaco_id) : null,
    descricao: row.descricao || '',
    valorTotal,
    valorPago,
    valorFalta: Math.max(0, valorTotal - valorPago),
    obs: row.obs || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function parseMoney(value, label) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) {
    throw Object.assign(new Error(`${label} inválido`), { status: 400 });
  }
  return n;
}

export async function migrateArrecadacao(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arrecadacao (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      participante_id INT UNSIGNED NOT NULL,
      tipo ENUM('espaco', 'patrocinio') NOT NULL DEFAULT 'patrocinio',
      espaco_id INT UNSIGNED NULL,
      descricao VARCHAR(255) NOT NULL DEFAULT '',
      valor_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
      valor_pago DECIMAL(12, 2) NOT NULL DEFAULT 0,
      obs TEXT,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_arrecadacao_espaco (espaco_id),
      INDEX idx_arrecadacao_participante (participante_id),
      INDEX idx_arrecadacao_tipo (tipo),
      CONSTRAINT fk_arrecadacao_participante FOREIGN KEY (participante_id) REFERENCES participantes(id),
      CONSTRAINT fk_arrecadacao_espaco FOREIGN KEY (espaco_id) REFERENCES espacos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function pickSaleGroupLeaders(espacos) {
  const leaders = new Map();
  for (const e of espacos) {
    if (!e.sale_group) continue;
    const key = e.sale_group;
    const cur = leaders.get(key);
    if (!cur || e.numero < cur.numero) leaders.set(key, e);
  }
  return new Set([...leaders.values()].map((e) => e.id));
}

function valorEspacoParaArrecadacao(espaco, leaders) {
  if (espaco.sale_group && !leaders.has(espaco.id)) return null;
  return espaco.valor != null ? Number(espaco.valor) : 0;
}

export async function syncArrecadacaoForGrupo(pool, grupoId) {
  const [espacos] = await pool.query(
    `SELECT e.id, e.numero, e.label, e.participante_id, e.status, e.valor, e.sale_group,
            g.nome AS grupo_nome
     FROM espacos e
     JOIN grupos_espacos g ON g.id = e.grupo_id
     WHERE e.grupo_id = ?`,
    [grupoId],
  );

  const leaders = pickSaleGroupLeaders(espacos);
  const keepEspacoIds = [];

  for (const e of espacos) {
    if (!e.participante_id || !ACTIVE_STATUS.has(e.status)) continue;

    const valorTotal = valorEspacoParaArrecadacao(e, leaders);
    if (valorTotal === null) continue;

    keepEspacoIds.push(e.id);
    const descricao = `${e.label || `Espaço ${e.numero}`} — ${e.grupo_nome}`;
    const grupoSuffix = e.sale_group ? ' · venda em grupo' : '';

    const [existing] = await pool.query(
      'SELECT id, valor_pago FROM arrecadacao WHERE espaco_id = ? LIMIT 1',
      [e.id],
    );

    if (existing[0]) {
      await pool.query(
        `UPDATE arrecadacao SET
           participante_id = ?, descricao = ?, valor_total = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [e.participante_id, descricao + grupoSuffix, valorTotal, existing[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO arrecadacao
           (participante_id, tipo, espaco_id, descricao, valor_total, valor_pago, updated_at)
         VALUES (?, 'espaco', ?, ?, ?, 0, CURRENT_TIMESTAMP(3))`,
        [e.participante_id, e.id, descricao + grupoSuffix, valorTotal],
      );
    }
  }

  if (keepEspacoIds.length === 0) {
    await pool.query(
      `DELETE a FROM arrecadacao a
       INNER JOIN espacos e ON e.id = a.espaco_id
       WHERE e.grupo_id = ? AND a.tipo = 'espaco'`,
      [grupoId],
    );
    return;
  }

  const placeholders = keepEspacoIds.map(() => '?').join(', ');
  await pool.query(
    `DELETE a FROM arrecadacao a
     INNER JOIN espacos e ON e.id = a.espaco_id
     WHERE e.grupo_id = ? AND a.tipo = 'espaco' AND a.espaco_id NOT IN (${placeholders})`,
    [grupoId, ...keepEspacoIds],
  );
}

export async function syncAllArrecadacaoFromEspacos(pool) {
  const [grupos] = await pool.query('SELECT id FROM grupos_espacos');
  for (const g of grupos) {
    await syncArrecadacaoForGrupo(pool, g.id);
  }
}

export async function listArrecadacao(pool) {
  const [rows] = await pool.query(
    `SELECT a.id, a.participante_id, a.tipo, a.espaco_id, a.descricao,
            a.valor_total, a.valor_pago, a.obs, a.created_at, a.updated_at,
            p.nome AS participante_nome
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     ORDER BY p.nome, a.tipo, a.descricao`,
  );
  return rows.map(rowToArrecadacao);
}

export async function findArrecadacaoById(pool, id) {
  const [rows] = await pool.query(
    `SELECT a.id, a.participante_id, a.tipo, a.espaco_id, a.descricao,
            a.valor_total, a.valor_pago, a.obs, a.created_at, a.updated_at,
            p.nome AS participante_nome
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToArrecadacao(rows[0]) : null;
}

export async function createPatrocinio(pool, raw) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const participanteId = await resolveParticipanteFromBody(conn, raw);
    const valorTotal = parseMoney(raw.valorTotal ?? raw.valor_total, 'Valor total');
    const valorPago = parseMoney(raw.valorPago ?? raw.valor_pago ?? 0, 'Valor pago');
    const descricao = String(raw.descricao || 'Patrocínio').trim() || 'Patrocínio';
    const obs = String(raw.obs || '').trim();

    const [result] = await conn.query(
      `INSERT INTO arrecadacao
         (participante_id, tipo, espaco_id, descricao, valor_total, valor_pago, obs, updated_at)
       VALUES (?, 'patrocinio', NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [participanteId, descricao, valorTotal, valorPago, obs || null],
    );

    await conn.commit();
    return findArrecadacaoById(pool, result.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateArrecadacao(pool, id, raw) {
  const existing = await findArrecadacaoById(pool, id);
  if (!existing) return null;

  const valorTotal = parseMoney(
    raw.valorTotal ?? raw.valor_total ?? existing.valorTotal,
    'Valor total',
  );
  const valorPago = parseMoney(
    raw.valorPago ?? raw.valor_pago ?? existing.valorPago,
    'Valor pago',
  );
  if (valorPago > valorTotal) {
    throw Object.assign(new Error('Valor pago não pode ser maior que o valor total'), {
      status: 400,
    });
  }

  const obs = raw.obs !== undefined ? String(raw.obs || '').trim() : existing.obs;
  let descricao = existing.descricao;
  if (existing.tipo === 'patrocinio' && raw.descricao !== undefined) {
    descricao = String(raw.descricao || 'Patrocínio').trim() || 'Patrocínio';
  }

  let participanteId = existing.participanteId;
  if (existing.tipo === 'patrocinio' && (raw.participanteId || raw.participanteNome)) {
    const conn = await pool.getConnection();
    try {
      participanteId = await resolveParticipanteFromBody(conn, raw);
    } finally {
      conn.release();
    }
  }

  await pool.query(
    `UPDATE arrecadacao SET
       participante_id = ?, descricao = ?, valor_total = ?, valor_pago = ?, obs = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [participanteId, descricao, valorTotal, valorPago, obs || null, id],
  );

  return findArrecadacaoById(pool, id);
}

export async function deleteArrecadacao(pool, id) {
  const existing = await findArrecadacaoById(pool, id);
  if (!existing) return false;
  if (existing.tipo === 'espaco') {
    throw Object.assign(
      new Error('Registros de espaço são gerenciados automaticamente pelos espaços'),
      { status: 400 },
    );
  }
  const [result] = await pool.query('DELETE FROM arrecadacao WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countArrecadacaoByParticipante(pool, participanteId) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM arrecadacao WHERE participante_id = ?',
    [participanteId],
  );
  return Number(rows[0]?.total || 0);
}

async function resolveParticipanteFromBody(conn, raw) {
  const id =
    raw.participanteId != null && raw.participanteId !== '' ? Number(raw.participanteId) : null;
  const nome = String(raw.participanteNome || raw.participante_nome || '').trim();
  if (!id && !nome) {
    throw Object.assign(new Error('Informe o participante ou patrocinador'), { status: 400 });
  }
  const participanteId = await ensureParticipante(conn, { id, nome });
  if (!participanteId) {
    throw Object.assign(new Error('Participante inválido'), { status: 400 });
  }
  return participanteId;
}

export function summarizeArrecadacao(items) {
  let total = 0;
  let pago = 0;
  for (const item of items) {
    total += item.valorTotal;
    pago += item.valorPago;
  }
  return {
    total,
    pago,
    falta: Math.max(0, total - pago),
    count: items.length,
  };
}
