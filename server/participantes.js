function rowToParticipante(row) {
  return {
    id: row.id,
    nome: row.nome || '',
    instagram: row.instagram || '',
    seguidores: row.seguidores != null ? Number(row.seguidores) : null,
    contatoNome: row.contato_nome || '',
    contatoTelefone: row.contato_telefone || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeInstagram(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.startsWith('@') ? s : `@${s.replace(/^@+/, '')}`;
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

export function normalizeParticipanteInput(body, { requireNome = true } = {}) {
  const nome = String(body?.nome || '').trim();
  if (requireNome && !nome) {
    throw Object.assign(new Error('Nome é obrigatório'), { status: 400 });
  }

  const instagram = normalizeInstagram(body?.instagram);
  const seguidoresRaw = body?.seguidores;
  const seguidores =
    seguidoresRaw != null && seguidoresRaw !== '' ? Number(seguidoresRaw) : null;
  if (seguidores != null && (!Number.isInteger(seguidores) || seguidores < 0)) {
    throw Object.assign(new Error('Número de seguidores inválido'), { status: 400 });
  }

  return {
    nome,
    instagram,
    seguidores,
    contatoNome: String(body?.contatoNome || body?.contato_nome || '').trim(),
    contatoTelefone: normalizePhone(body?.contatoTelefone || body?.contato_telefone),
  };
}

export async function migrateParticipantes(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participantes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      instagram VARCHAR(100) NOT NULL DEFAULT '',
      seguidores INT UNSIGNED NULL,
      contato_nome VARCHAR(255) NOT NULL DEFAULT '',
      contato_telefone VARCHAR(20) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_participantes_nome (nome)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'espacos' AND COLUMN_NAME = 'participante_id'`,
  );
  if (cols.length === 0) {
    await pool.query(`
      ALTER TABLE espacos
        ADD COLUMN participante_id INT UNSIGNED NULL AFTER client,
        ADD INDEX idx_espacos_participante (participante_id),
        ADD CONSTRAINT fk_espacos_participante
          FOREIGN KEY (participante_id) REFERENCES participantes(id)
          ON DELETE SET NULL
    `);
  }
}

export async function listParticipantes(pool) {
  const [rows] = await pool.query(
    `SELECT id, nome, instagram, seguidores, contato_nome, contato_telefone, created_at, updated_at
     FROM participantes ORDER BY nome`,
  );
  return rows.map(rowToParticipante);
}

export async function findParticipanteById(pool, id) {
  const [rows] = await pool.query(
    `SELECT id, nome, instagram, seguidores, contato_nome, contato_telefone, created_at, updated_at
     FROM participantes WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToParticipante(rows[0]) : null;
}

export async function createParticipante(pool, input) {
  const data = normalizeParticipanteInput(input);
  const [result] = await pool.query(
    `INSERT INTO participantes (nome, instagram, seguidores, contato_nome, contato_telefone, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [data.nome, data.instagram, data.seguidores, data.contatoNome, data.contatoTelefone],
  );
  return findParticipanteById(pool, result.insertId);
}

export async function updateParticipante(pool, id, input) {
  const data = normalizeParticipanteInput(input);
  const [result] = await pool.query(
    `UPDATE participantes SET
       nome = ?, instagram = ?, seguidores = ?, contato_nome = ?, contato_telefone = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [data.nome, data.instagram, data.seguidores, data.contatoNome, data.contatoTelefone, id],
  );
  if (result.affectedRows === 0) return null;
  return findParticipanteById(pool, id);
}

export async function upsertParticipanteByNome(pool, input) {
  const data = normalizeParticipanteInput(input);
  const [existing] = await pool.query(
    'SELECT id FROM participantes WHERE LOWER(nome) = LOWER(?) LIMIT 1',
    [data.nome],
  );
  if (existing[0]) {
    return { participante: await updateParticipante(pool, existing[0].id, input), created: false };
  }
  return { participante: await createParticipante(pool, input), created: true };
}

export async function deleteParticipante(pool, id) {
  const [result] = await pool.query('DELETE FROM participantes WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countEspacosByParticipante(pool, id) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM espacos WHERE participante_id = ?',
    [id],
  );
  return Number(rows[0]?.total || 0);
}

export async function countReferenciasParticipante(pool, id) {
  const espacos = await countEspacosByParticipante(pool, id);
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM arrecadacao WHERE participante_id = ?',
    [id],
  );
  const arrecadacao = Number(rows[0]?.total || 0);
  return { espacos, arrecadacao, total: espacos + arrecadacao };
}

/** Busca por nome (case-insensitive) ou cria só com o nome. */
export async function ensureParticipante(conn, { id, nome }) {
  if (id) {
    const [rows] = await conn.query('SELECT id FROM participantes WHERE id = ? LIMIT 1', [id]);
    if (rows[0]) return rows[0].id;
  }

  const trimmed = String(nome || '').trim();
  if (!trimmed) return null;

  const [existing] = await conn.query(
    'SELECT id FROM participantes WHERE LOWER(nome) = LOWER(?) LIMIT 1',
    [trimmed],
  );
  if (existing[0]) return existing[0].id;

  const [result] = await conn.query(
    `INSERT INTO participantes (nome, instagram, seguidores, contato_nome, contato_telefone, updated_at)
     VALUES (?, '', NULL, '', '', CURRENT_TIMESTAMP(3))`,
    [trimmed],
  );
  return result.insertId;
}

export async function resolveParticipanteId(conn, raw, existingId) {
  if (!('participanteId' in raw) && !('participanteNome' in raw)) {
    return existingId ?? null;
  }

  const id =
    raw.participanteId != null && raw.participanteId !== ''
      ? Number(raw.participanteId)
      : null;
  const nome = String(raw.participanteNome || '').trim();

  if (id) return ensureParticipante(conn, { id, nome: '' });
  if (!nome) return null;
  return ensureParticipante(conn, { nome });
}
