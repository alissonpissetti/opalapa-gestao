import { ensureParticipante } from './participantes.js';
import { ensureWhatsappContatoArrecadacao } from './arrecadacao.js';

const ANO_MIN = 1968;
const ANO_MAX = 1992;
const SITUACOES = ['confirmado', 'negociacao', 'desejado'];

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
    veiculo: row.veiculo || '',
    nome: row.nome,
    telefone: row.telefone || '',
    ano: Number(row.ano),
    cidadeUf: row.cidade_uf || '',
    situacao: row.situacao,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeInput(raw) {
  const veiculo = String(raw.veiculo || '').trim();
  if (!veiculo) throw Object.assign(new Error('Informe o veículo'), { status: 400 });

  const nome = String(raw.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome'), { status: 400 });

  const ano = Number(raw.ano);
  if (!Number.isInteger(ano) || ano < ANO_MIN || ano > ANO_MAX) {
    throw Object.assign(new Error(`Ano deve estar entre ${ANO_MIN} e ${ANO_MAX}`), { status: 400 });
  }

  const telefone = normalizePhone(raw.telefone);
  const telefoneValue = telefone || null;

  const cidadeUf = String(raw.cidadeUf ?? raw.cidade_uf ?? '').trim() || null;

  let situacao = String(raw.situacao || 'desejado').toLowerCase();
  if (!SITUACOES.includes(situacao)) {
    throw Object.assign(new Error('Situação inválida'), { status: 400 });
  }

  return { veiculo, nome, telefone: telefoneValue, ano, cidadeUf, situacao };
}

const CRONOLOGIA_SELECT = `
  SELECT id, evento_id, participante_id, veiculo, nome, telefone, ano, cidade_uf, situacao, created_at, updated_at
  FROM producao_cronologia
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

async function syncCronologiaParticipante(pool, eventoId, data) {
  if (!data.telefone) return null;

  const conn = await pool.getConnection();
  try {
    const byPhone = await findParticipanteIdByPhone(pool, data.telefone);
    const participanteId = await ensureParticipante(conn, {
      id: byPhone || undefined,
      nome: data.nome,
      contatoTelefone: data.telefone,
    });
    if (!participanteId) return null;

    await ensureWhatsappContatoArrecadacao(pool, eventoId, participanteId, {
      descricao: `Cronologia · ${data.nome}`,
    });
    return participanteId;
  } finally {
    conn.release();
  }
}

export async function migrateProducaoCronologia(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_veiculos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(120) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_producao_veiculos_evento_nome (evento_id, nome),
      INDEX idx_producao_veiculos_evento (evento_id),
      CONSTRAINT fk_producao_veiculos_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_cronologia (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(200) NOT NULL,
      telefone VARCHAR(20) NULL,
      ano SMALLINT UNSIGNED NOT NULL,
      cidade_uf VARCHAR(120) NULL,
      situacao ENUM('confirmado', 'negociacao', 'desejado') NOT NULL DEFAULT 'desejado',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_producao_cronologia_evento (evento_id),
      INDEX idx_producao_cronologia_ano (evento_id, ano),
      CONSTRAINT fk_producao_cronologia_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producao_cronologia'`,
  );
  const colSet = new Set(cols.map((c) => c.name));
  if (!colSet.has('veiculo')) {
    await pool.query(
      "ALTER TABLE producao_cronologia ADD COLUMN veiculo VARCHAR(120) NOT NULL DEFAULT '' AFTER evento_id",
    );
    await pool.query(`
      INSERT IGNORE INTO producao_veiculos (evento_id, nome)
      SELECT DISTINCT evento_id, veiculo
      FROM producao_cronologia
      WHERE veiculo IS NOT NULL AND veiculo != ''
    `);
  }
  if (!colSet.has('participante_id')) {
    await pool.query(
      'ALTER TABLE producao_cronologia ADD COLUMN participante_id INT UNSIGNED NULL AFTER evento_id',
    );
    await pool.query(`
      ALTER TABLE producao_cronologia
      ADD INDEX idx_producao_cronologia_participante (participante_id),
      ADD CONSTRAINT fk_producao_cronologia_participante
        FOREIGN KEY (participante_id) REFERENCES participantes(id) ON DELETE SET NULL
    `);
  }
}

export async function listProducaoVeiculos(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT nome FROM producao_veiculos
     WHERE evento_id = ?
     ORDER BY nome ASC`,
    [eventoId],
  );
  return rows.map((r) => r.nome);
}

export async function ensureProducaoVeiculo(pool, eventoId, nome) {
  const trimmed = String(nome || '').trim();
  if (!trimmed) return false;

  const [existing] = await pool.query(
    `SELECT id FROM producao_veiculos
     WHERE evento_id = ? AND LOWER(nome) = LOWER(?)
     LIMIT 1`,
    [eventoId, trimmed],
  );
  if (existing.length > 0) return false;

  await pool.query('INSERT INTO producao_veiculos (evento_id, nome) VALUES (?, ?)', [
    eventoId,
    trimmed,
  ]);
  return true;
}

export async function listProducaoCronologia(pool, eventoId) {
  const [rows] = await pool.query(
    `${CRONOLOGIA_SELECT}
     WHERE evento_id = ?
     ORDER BY ano ASC, veiculo ASC, nome ASC, id ASC`,
    [eventoId],
  );
  const veiculos = await listProducaoVeiculos(pool, eventoId);
  return { items: rows.map(rowToItem), veiculos };
}

export async function createProducaoCronologia(pool, eventoId, raw) {
  const data = normalizeInput(raw);
  await ensureProducaoVeiculo(pool, eventoId, data.veiculo);
  const participanteId = await syncCronologiaParticipante(pool, eventoId, data);
  const [result] = await pool.query(
    `INSERT INTO producao_cronologia (evento_id, participante_id, veiculo, nome, telefone, ano, cidade_uf, situacao, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      participanteId,
      data.veiculo,
      data.nome,
      data.telefone,
      data.ano,
      data.cidadeUf,
      data.situacao,
    ],
  );
  const [rows] = await pool.query(`${CRONOLOGIA_SELECT} WHERE id = ?`, [result.insertId]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function updateProducaoCronologia(pool, id, eventoId, raw) {
  const data = normalizeInput(raw);
  await ensureProducaoVeiculo(pool, eventoId, data.veiculo);
  const participanteId = await syncCronologiaParticipante(pool, eventoId, data);
  const [result] = await pool.query(
    `UPDATE producao_cronologia
     SET participante_id = ?, veiculo = ?, nome = ?, telefone = ?, ano = ?, cidade_uf = ?, situacao = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      participanteId,
      data.veiculo,
      data.nome,
      data.telefone,
      data.ano,
      data.cidadeUf,
      data.situacao,
      id,
      eventoId,
    ],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(`${CRONOLOGIA_SELECT} WHERE id = ? AND evento_id = ?`, [
    id,
    eventoId,
  ]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function deleteProducaoCronologia(pool, id, eventoId) {
  const [result] = await pool.query(
    'DELETE FROM producao_cronologia WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}
