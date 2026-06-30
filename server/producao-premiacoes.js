import { ensureParticipante } from './participantes.js';
import { ensureWhatsappContatoArrecadacao } from './arrecadacao.js';

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

function rowToItem(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    participanteId: row.participante_id != null ? Number(row.participante_id) : null,
    nome: row.nome,
    descricao: row.descricao || '',
    vencedorNome: row.vencedor_nome || '',
    vencedorTelefone: row.vencedor_telefone || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeInput(raw) {
  const nome = String(raw.nome ?? '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome do prêmio'), { status: 400 });

  const descricao = String(raw.descricao ?? '').trim() || null;
  const vencedorNome = String(raw.vencedorNome ?? raw.vencedor_nome ?? '').trim() || null;
  const vencedorTelefone = normalizePhone(raw.vencedorTelefone ?? raw.vencedor_telefone) || null;

  if (vencedorTelefone && !vencedorNome) {
    throw Object.assign(new Error('Informe o nome do vencedor ao cadastrar o telefone'), {
      status: 400,
    });
  }

  return { nome, descricao, vencedorNome, vencedorTelefone };
}

const PREMIACOES_SELECT = `
  SELECT id, evento_id, participante_id, nome, descricao, vencedor_nome, vencedor_telefone, created_at, updated_at
  FROM producao_premiacoes
`;

async function findParticipanteIdByPhone(pool, telefone) {
  const phone = normalizePhone(telefone);
  if (!phone) return null;
  const [rows] = await pool.query(
    'SELECT id FROM participantes WHERE contato_telefone = ? LIMIT 1',
    [phone],
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

async function syncPremiacaoParticipante(pool, eventoId, data) {
  if (!data.vencedorTelefone) return null;

  const conn = await pool.getConnection();
  try {
    const byPhone = await findParticipanteIdByPhone(pool, data.vencedorTelefone);
    const participanteId = await ensureParticipante(conn, {
      id: byPhone || undefined,
      nome: data.vencedorNome,
      contatoTelefone: data.vencedorTelefone,
    });
    if (!participanteId) return null;

    await ensureWhatsappContatoArrecadacao(pool, eventoId, participanteId, {
      descricao: `Premiação · ${data.nome}`,
    });
    return participanteId;
  } finally {
    conn.release();
  }
}

export async function migrateProducaoPremiacoes(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_premiacoes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      participante_id INT UNSIGNED NULL,
      nome VARCHAR(200) NOT NULL,
      descricao TEXT NULL,
      vencedor_nome VARCHAR(200) NULL,
      vencedor_telefone VARCHAR(20) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_producao_premiacoes_evento (evento_id),
      INDEX idx_producao_premiacoes_nome (evento_id, nome),
      CONSTRAINT fk_producao_premiacoes_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
      CONSTRAINT fk_producao_premiacoes_participante FOREIGN KEY (participante_id) REFERENCES participantes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listProducaoPremiacoes(pool, eventoId) {
  const [rows] = await pool.query(
    `${PREMIACOES_SELECT}
     WHERE evento_id = ?
     ORDER BY nome ASC, id ASC`,
    [eventoId],
  );
  return { items: rows.map(rowToItem) };
}

export async function createProducaoPremiacao(pool, eventoId, raw) {
  const data = normalizeInput(raw);
  const participanteId = await syncPremiacaoParticipante(pool, eventoId, data);
  const [result] = await pool.query(
    `INSERT INTO producao_premiacoes (
       evento_id, participante_id, nome, descricao, vencedor_nome, vencedor_telefone, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      participanteId,
      data.nome,
      data.descricao,
      data.vencedorNome,
      data.vencedorTelefone,
    ],
  );
  const [rows] = await pool.query(`${PREMIACOES_SELECT} WHERE id = ?`, [result.insertId]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function updateProducaoPremiacao(pool, id, eventoId, raw) {
  const data = normalizeInput(raw);
  const participanteId = await syncPremiacaoParticipante(pool, eventoId, data);
  const [result] = await pool.query(
    `UPDATE producao_premiacoes
     SET participante_id = ?, nome = ?, descricao = ?, vencedor_nome = ?, vencedor_telefone = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      participanteId,
      data.nome,
      data.descricao,
      data.vencedorNome,
      data.vencedorTelefone,
      id,
      eventoId,
    ],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(`${PREMIACOES_SELECT} WHERE id = ? AND evento_id = ?`, [
    id,
    eventoId,
  ]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function deleteProducaoPremiacao(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM producao_premiacoes WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}
