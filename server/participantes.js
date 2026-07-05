import { recordSeguidoresHistorico } from './seguidores-historico.js';
import { syncParticipanteAvatar } from './whatsapp-avatars.js';

function rowToParticipante(row) {
  return {
    id: row.id,
    nome: row.nome || '',
    instagram: row.instagram || '',
    seguidores: row.seguidores != null ? Number(row.seguidores) : null,
    contatoNome: row.contato_nome || '',
    contatoTelefone: row.contato_telefone || '',
    whatsappAvatarPath: row.whatsapp_avatar_path || null,
    whatsappAvatarSyncedAt: row.whatsapp_avatar_synced_at
      ? new Date(row.whatsapp_avatar_synced_at).toISOString()
      : null,
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

/** Busca participante existente por WhatsApp ou Instagram. */
export async function findParticipanteByContato(conn, { telefone, instagram } = {}) {
  const phone = normalizePhone(telefone);
  const ig = normalizeInstagram(instagram);

  if (phone) {
    const [rows] = await conn.query(
      'SELECT id FROM participantes WHERE contato_telefone = ? LIMIT 1',
      [phone],
    );
    if (rows[0]) return Number(rows[0].id);
  }

  if (ig) {
    const igLower = ig.toLowerCase();
    const igBare = igLower.replace(/^@+/, '');
    const [rows] = await conn.query(
      `SELECT id FROM participantes
       WHERE LOWER(instagram) = ? OR LOWER(REPLACE(instagram, '@', '')) = ?
       LIMIT 1`,
      [igLower, igBare],
    );
    if (rows[0]) return Number(rows[0].id);
  }

  return null;
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

  const [avatarCols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participantes' AND COLUMN_NAME = 'whatsapp_avatar_path'`,
  );
  if (avatarCols.length === 0) {
    await pool.query(`
      ALTER TABLE participantes
        ADD COLUMN whatsapp_avatar_path VARCHAR(512) NULL AFTER contato_telefone,
        ADD COLUMN whatsapp_avatar_synced_at DATETIME(3) NULL AFTER whatsapp_avatar_path
    `);
  }
}

export async function listParticipantes(pool) {
  const [rows] = await pool.query(
    `SELECT id, nome, instagram, seguidores, contato_nome, contato_telefone,
            whatsapp_avatar_path, whatsapp_avatar_synced_at, created_at, updated_at
     FROM participantes ORDER BY nome`,
  );
  return rows.map(rowToParticipante);
}

export async function findParticipanteById(pool, id) {
  const [rows] = await pool.query(
    `SELECT id, nome, instagram, seguidores, contato_nome, contato_telefone,
            whatsapp_avatar_path, whatsapp_avatar_synced_at, created_at, updated_at
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
  const created = await findParticipanteById(pool, result.insertId);
  if (created && data.seguidores != null) {
    await recordSeguidoresHistorico(pool, {
      participanteId: created.id,
      anterior: null,
      novo: data.seguidores,
    });
  }
  if (created?.contatoTelefone) {
    void syncParticipanteAvatar(pool, created.id, created.contatoTelefone, { force: true }).catch(() => {});
  }
  return created;
}

export async function updateParticipante(pool, id, input) {
  const existing = await findParticipanteById(pool, id);
  if (!existing) return null;

  const data = normalizeParticipanteInput(input);
  const arrecadacaoIdRaw = input?.arrecadacaoId ?? input?.arrecadacao_id;
  const arrecadacaoId =
    arrecadacaoIdRaw != null && arrecadacaoIdRaw !== '' ? Number(arrecadacaoIdRaw) : null;

  const [result] = await pool.query(
    `UPDATE participantes SET
       nome = ?, instagram = ?, seguidores = ?, contato_nome = ?, contato_telefone = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [data.nome, data.instagram, data.seguidores, data.contatoNome, data.contatoTelefone, id],
  );
  if (result.affectedRows === 0) return null;

  if (data.seguidores !== existing.seguidores) {
    await recordSeguidoresHistorico(pool, {
      participanteId: id,
      anterior: existing.seguidores,
      novo: data.seguidores,
      arrecadacaoId: Number.isInteger(arrecadacaoId) && arrecadacaoId > 0 ? arrecadacaoId : null,
    });
  }

  const updated = await findParticipanteById(pool, id);
  if (updated?.contatoTelefone && updated.contatoTelefone !== existing.contatoTelefone) {
    void syncParticipanteAvatar(pool, id, updated.contatoTelefone, { force: true }).catch(() => {});
  }
  return updated;
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

export async function countReferenciasParticipante(pool, id, eventoId = null) {
  let espacos = 0;
  if (eventoId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total FROM espacos e
       JOIN grupos_espacos g ON g.id = e.grupo_id
       WHERE e.participante_id = ? AND g.evento_id = ?`,
      [id, eventoId],
    );
    espacos = Number(rows[0]?.total || 0);
  } else {
    espacos = await countEspacosByParticipante(pool, id);
  }

  const [rows] = await pool.query(
    eventoId
      ? 'SELECT COUNT(*) AS total FROM arrecadacao WHERE participante_id = ? AND evento_id = ?'
      : 'SELECT COUNT(*) AS total FROM arrecadacao WHERE participante_id = ?',
    eventoId ? [id, eventoId] : [id],
  );
  const arrecadacao = Number(rows[0]?.total || 0);
  return { espacos, arrecadacao, total: espacos + arrecadacao };
}

async function updateParticipanteContato(conn, id, { instagram, contatoTelefone, seguidores }) {
  const sets = [];
  const params = [];

  if (instagram !== undefined) {
    const ig = normalizeInstagram(instagram);
    sets.push('instagram = ?');
    params.push(ig);
  }
  if (contatoTelefone !== undefined) {
    const tel = normalizePhone(contatoTelefone);
    sets.push('contato_telefone = ?');
    params.push(tel);
  }
  let seguidoresAnterior;
  let seguidoresNovo;
  if (seguidores !== undefined) {
    const [atualRows] = await conn.query('SELECT seguidores FROM participantes WHERE id = ? LIMIT 1', [
      id,
    ]);
    seguidoresAnterior =
      atualRows[0]?.seguidores != null ? Number(atualRows[0].seguidores) : null;
    seguidoresNovo = seguidores != null && seguidores !== '' ? Number(seguidores) : null;
    if (seguidoresNovo != null && (!Number.isInteger(seguidoresNovo) || seguidoresNovo < 0)) {
      throw Object.assign(new Error('Número de seguidores inválido'), { status: 400 });
    }
    sets.push('seguidores = ?');
    params.push(seguidoresNovo);
  }

  if (!sets.length) return;

  sets.push('updated_at = CURRENT_TIMESTAMP(3)');
  params.push(id);
  await conn.query(`UPDATE participantes SET ${sets.join(', ')} WHERE id = ?`, params);

  if (seguidores !== undefined && seguidoresAnterior !== seguidoresNovo) {
    await recordSeguidoresHistorico(conn, {
      participanteId: id,
      anterior: seguidoresAnterior,
      novo: seguidoresNovo,
    });
  }
}

/** Busca por nome (case-insensitive) ou cria com os dados informados. */
export async function ensureParticipante(conn, { id, nome, instagram, contatoTelefone, seguidores }) {
  if (id) {
    const [rows] = await conn.query('SELECT id FROM participantes WHERE id = ? LIMIT 1', [id]);
    if (rows[0]) {
      await updateParticipanteContato(conn, rows[0].id, {
        instagram,
        contatoTelefone,
        seguidores,
      });
      return rows[0].id;
    }
  }

  const trimmed = String(nome || '').trim();
  if (!trimmed) return null;

  const data = normalizeParticipanteInput(
    { nome: trimmed, instagram, contatoTelefone },
    { requireNome: true },
  );

  const [existing] = await conn.query(
    'SELECT id FROM participantes WHERE LOWER(nome) = LOWER(?) LIMIT 1',
    [trimmed],
  );
  if (existing[0]) {
    await updateParticipanteContato(conn, existing[0].id, {
      instagram: data.instagram,
      contatoTelefone: data.contatoTelefone,
      seguidores,
    });
    return existing[0].id;
  }

  const [result] = await conn.query(
    `INSERT INTO participantes (nome, instagram, seguidores, contato_nome, contato_telefone, updated_at)
     VALUES (?, ?, NULL, '', ?, CURRENT_TIMESTAMP(3))`,
    [data.nome, data.instagram, data.contatoTelefone],
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
