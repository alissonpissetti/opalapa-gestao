const TIPOS_INTERACAO = new Set(['nota', 'ligacao', 'whatsapp', 'email', 'reuniao', 'sistema']);

const TIPO_LABELS = {
  nota: 'Nota',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao: 'Reunião',
  sistema: 'Registro automático',
};

function rowToInteracao(row) {
  return {
    id: row.id,
    arrecadacaoId: Number(row.arrecadacao_id),
    tipo: row.tipo,
    tipoLabel: TIPO_LABELS[row.tipo] || row.tipo,
    texto: row.texto || '',
    criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : null,
  };
}

export async function migrateInteracoes(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arrecadacao_interacoes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      arrecadacao_id INT UNSIGNED NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'nota',
      texto TEXT NOT NULL,
      criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_interacoes_arrecadacao (arrecadacao_id, criado_em),
      CONSTRAINT fk_interacoes_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listInteracoes(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, tipo, texto, criado_em
     FROM arrecadacao_interacoes
     WHERE arrecadacao_id = ?
     ORDER BY criado_em DESC, id DESC`,
    [arrecadacaoId],
  );
  return rows.map(rowToInteracao);
}

export async function createInteracao(pool, arrecadacaoId, raw) {
  const tipo = String(raw.tipo || 'nota').trim();
  if (!TIPOS_INTERACAO.has(tipo)) {
    throw Object.assign(new Error('Tipo de interação inválido'), { status: 400 });
  }
  const texto = String(raw.texto || '').trim();
  if (!texto) {
    throw Object.assign(new Error('Informe o texto da interação'), { status: 400 });
  }

  const [result] = await pool.query(
    `INSERT INTO arrecadacao_interacoes (arrecadacao_id, tipo, texto)
     VALUES (?, ?, ?)`,
    [arrecadacaoId, tipo, texto],
  );

  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, tipo, texto, criado_em
     FROM arrecadacao_interacoes WHERE id = ? LIMIT 1`,
    [result.insertId],
  );
  return rows[0] ? rowToInteracao(rows[0]) : null;
}
