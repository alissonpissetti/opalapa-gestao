function rowToHistorico(row) {
  return {
    id: row.id,
    participanteId: Number(row.participante_id),
    seguidores: row.seguidores != null ? Number(row.seguidores) : null,
    seguidoresAnterior:
      row.seguidores_anterior != null ? Number(row.seguidores_anterior) : null,
    variacao: row.variacao != null ? Number(row.variacao) : null,
    arrecadacaoId: row.arrecadacao_id != null ? Number(row.arrecadacao_id) : null,
    registradoEm: row.registrado_em ? new Date(row.registrado_em).toISOString() : null,
  };
}

export async function migrateSeguidoresHistorico(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participantes_seguidores_historico (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      participante_id INT UNSIGNED NOT NULL,
      seguidores INT UNSIGNED NULL,
      seguidores_anterior INT UNSIGNED NULL,
      variacao INT NULL,
      arrecadacao_id INT UNSIGNED NULL,
      registrado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_seguidores_hist_participante (participante_id, registrado_em),
      CONSTRAINT fk_seguidores_hist_participante
        FOREIGN KEY (participante_id) REFERENCES participantes(id) ON DELETE CASCADE,
      CONSTRAINT fk_seguidores_hist_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    INSERT INTO participantes_seguidores_historico
      (participante_id, seguidores, seguidores_anterior, variacao, registrado_em)
    SELECT p.id, p.seguidores, NULL, NULL, COALESCE(p.updated_at, p.created_at)
    FROM participantes p
    WHERE p.seguidores IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM participantes_seguidores_historico h WHERE h.participante_id = p.id
      )
  `);
}

export async function recordSeguidoresHistorico(
  pool,
  { participanteId, anterior, novo, arrecadacaoId = null },
) {
  const id = Number(participanteId);
  if (!Number.isInteger(id) || id < 1) return null;
  if (anterior === novo) return null;

  const variacao =
    anterior != null && novo != null ? Number(novo) - Number(anterior) : null;

  const [result] = await pool.query(
    `INSERT INTO participantes_seguidores_historico
       (participante_id, seguidores, seguidores_anterior, variacao, arrecadacao_id, registrado_em)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [id, novo, anterior, variacao, arrecadacaoId],
  );
  return result.insertId;
}

export async function listSeguidoresHistorico(pool, participanteId, { limit = 50 } = {}) {
  const id = Number(participanteId);
  if (!Number.isInteger(id) || id < 1) return [];

  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await pool.query(
    `SELECT id, participante_id, seguidores, seguidores_anterior, variacao, arrecadacao_id, registrado_em
     FROM participantes_seguidores_historico
     WHERE participante_id = ?
     ORDER BY registrado_em DESC, id DESC
     LIMIT ?`,
    [id, max],
  );
  return rows.map(rowToHistorico);
}

export function summarizeSeguidoresHistorico(historico, seguidoresAtual = null) {
  if (!historico.length) {
    return {
      totalRegistros: 0,
      tendencia: 'indeterminado',
      variacaoTotal: null,
      variacaoRecente: null,
      primeiroRegistro: null,
      ultimoRegistro: null,
      seguidoresAtual,
    };
  }

  const ordenado = [...historico].sort(
    (a, b) => new Date(a.registradoEm) - new Date(b.registradoEm),
  );
  const primeiro = ordenado[0];
  const ultimo = ordenado[ordenado.length - 1];
  const atual = seguidoresAtual ?? ultimo.seguidores;

  const baseline =
    primeiro.seguidoresAnterior != null ? primeiro.seguidoresAnterior : primeiro.seguidores;
  const variacaoTotal =
    atual != null && baseline != null ? Number(atual) - Number(baseline) : null;

  const comVariacao = ordenado.filter((h) => h.variacao != null);
  const ultimasMudancas = [...historico]
    .filter((h) => h.variacao != null)
    .slice(0, 3);
  const variacaoRecente = ultimasMudancas.reduce((sum, h) => sum + Number(h.variacao), 0);

  let tendencia = 'estavel';
  if (comVariacao.length === 0) {
    tendencia = 'indeterminado';
  } else if (variacaoRecente > 0) {
    tendencia = 'crescendo';
  } else if (variacaoRecente < 0) {
    tendencia = 'em_queda';
  } else if (variacaoTotal != null) {
    if (variacaoTotal > 0) tendencia = 'crescendo';
    else if (variacaoTotal < 0) tendencia = 'em_queda';
  }

  return {
    totalRegistros: historico.length,
    tendencia,
    variacaoTotal,
    variacaoRecente: ultimasMudancas.length ? variacaoRecente : null,
    primeiroRegistro: primeiro.registradoEm,
    ultimoRegistro: ultimo.registradoEm,
    seguidoresAtual: atual,
    seguidoresInicial: baseline,
  };
}

export async function getSeguidoresHistoricoResumo(pool, participanteId) {
  const [participanteRows] = await pool.query(
    'SELECT seguidores FROM participantes WHERE id = ? LIMIT 1',
    [participanteId],
  );
  const seguidoresAtual =
    participanteRows[0]?.seguidores != null ? Number(participanteRows[0].seguidores) : null;

  const historico = await listSeguidoresHistorico(pool, participanteId);
  return {
    historico,
    resumo: summarizeSeguidoresHistorico(historico, seguidoresAtual),
  };
}
