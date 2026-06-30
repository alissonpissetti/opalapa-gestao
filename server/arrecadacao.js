import { ensureParticipante } from './participantes.js';
import { createTarefaContato } from './tarefas.js';
import {
  etapaByStatus,
  isPerdaStatus,
  listFunilEtapas,
  perdaEtapa,
  perdaStatuses,
  funilEscopoForTipo,
} from './funil.js';
const MOTIVOS_PERDA = new Set(['preco', 'desistiu', 'outro_evento', 'sem_retorno', 'perfil', 'outro']);

function parseStatus(value, fallback = 'neg') {
  const status = String(value || fallback).trim();
  if (!status || status.length > 32 || !/^[a-z0-9_]+$/.test(status)) {
    throw Object.assign(new Error(`Etapa inválida: ${status}`), { status: 400 });
  }
  return status;
}

function rowToArrecadacao(row) {
  const valorTotal = Number(row.valor_total);
  const valorPago = Number(row.valor_pago);
  return {
    id: row.id,
    participanteId: row.participante_id != null ? Number(row.participante_id) : null,
    participanteNome: row.participante_nome || '',
    tipo: row.tipo,
    status: row.status || 'neg',
    espacoId: row.espaco_id != null ? Number(row.espaco_id) : null,
    espacoNumero: row.espaco_numero != null ? Number(row.espaco_numero) : null,
    espacoGrupoSlug: row.espaco_grupo_slug || '',
    espacoTipo: row.espaco_tipo || '',
    descricao: row.descricao || '',
    valorTotal,
    valorPago,
    valorFalta: Math.max(0, valorTotal - valorPago),
    obs: row.obs || '',
    motivoPerda: row.motivo_perda || '',
    motivoPerdaOutro: row.motivo_perda_outro || '',
    marketingCanalId: row.marketing_canal_id != null ? Number(row.marketing_canal_id) : null,
    marketingCampanhaId: row.marketing_campanha_id != null ? Number(row.marketing_campanha_id) : null,
    marketingCriativoId: row.marketing_criativo_id != null ? Number(row.marketing_criativo_id) : null,
    marketingCanalNome: row.marketing_canal_nome || '',
    marketingCampanhaNome: row.marketing_campanha_nome || '',
    marketingCriativoNome: row.marketing_criativo_nome || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const ESPACO_STATUS = new Set(['disp', 'lead', 'neg', 'res', 'vend']);

async function espacoStatusForArrecadacao(pool, eventoId, arrecadacaoStatus) {
  if (!ESPACO_STATUS.has(arrecadacaoStatus)) {
    const etapas =
      eventoId != null ? await listFunilEtapas(pool, eventoId, { escopo: 'comercial' }) : [];
    const etapa = etapaByStatus(etapas, arrecadacaoStatus);
    if (etapa?.tipo === 'venda') return 'vend';
    if (etapa?.tipo === 'perda') return 'disp';
    return 'neg';
  }
  return arrecadacaoStatus;
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
      tipo ENUM('espaco', 'patrocinio', 'artistico') NOT NULL DEFAULT 'patrocinio',
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

  const [cols] = await pool.query(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'participante_id'`,
  );
  if (cols[0]?.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE arrecadacao MODIFY participante_id INT UNSIGNED NULL');
  }

  const [statusCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'status'`,
  );
  if (statusCol.length === 0) {
    await pool.query(
      `ALTER TABLE arrecadacao
         ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'neg' AFTER tipo,
         ADD INDEX idx_arrecadacao_status (status)`,
    );
  }

  const [motivoCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'motivo_perda'`,
  );
  if (motivoCol.length === 0) {
    await pool.query(
      `ALTER TABLE arrecadacao
         ADD COLUMN motivo_perda VARCHAR(100) NULL AFTER obs,
         ADD COLUMN motivo_perda_outro TEXT NULL AFTER motivo_perda`,
    );
  }

  const [tipoCol] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'tipo'`,
  );
  const tipoEnum = tipoCol[0]?.COLUMN_TYPE || '';
  if (tipoEnum && !tipoEnum.includes('artistico')) {
    await pool.query(
      `ALTER TABLE arrecadacao MODIFY tipo ENUM('espaco', 'patrocinio', 'artistico') NOT NULL DEFAULT 'patrocinio'`,
    );
  }
  const [tipoCol2] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'tipo'`,
  );
  const tipoEnum2 = tipoCol2[0]?.COLUMN_TYPE || '';
  if (tipoEnum2 && !tipoEnum2.includes('contato')) {
    await pool.query(
      `ALTER TABLE arrecadacao MODIFY tipo ENUM('espaco', 'patrocinio', 'artistico', 'contato') NOT NULL DEFAULT 'patrocinio'`,
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arrecadacao_pagamentos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      arrecadacao_id INT UNSIGNED NOT NULL,
      participante_id INT UNSIGNED NOT NULL,
      valor DECIMAL(12, 2) NOT NULL,
      obs TEXT NULL,
      registrado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_pagamentos_arrecadacao (arrecadacao_id),
      INDEX idx_pagamentos_participante (participante_id),
      CONSTRAINT fk_pagamentos_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE,
      CONSTRAINT fk_pagamentos_participante
        FOREIGN KEY (participante_id) REFERENCES participantes(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [semHistorico] = await pool.query(
    `SELECT a.id, a.participante_id, a.valor_pago
     FROM arrecadacao a
     WHERE a.valor_pago > 0
       AND NOT EXISTS (
         SELECT 1 FROM arrecadacao_pagamentos p WHERE p.arrecadacao_id = a.id
       )`,
  );
  for (const row of semHistorico) {
    await pool.query(
      `INSERT INTO arrecadacao_pagamentos (arrecadacao_id, participante_id, valor, obs, registrado_em)
       VALUES (?, ?, ?, 'Saldo importado do cadastro anterior', COALESCE(
         (SELECT updated_at FROM arrecadacao WHERE id = ?),
         (SELECT created_at FROM arrecadacao WHERE id = ?)
       ))`,
      [row.id, row.participante_id, row.valor_pago, row.id, row.id],
    );
  }
}

function rowToPagamento(row) {
  return {
    id: row.id,
    arrecadacaoId: Number(row.arrecadacao_id),
    participanteId: Number(row.participante_id),
    valor: Number(row.valor),
    obs: row.obs || '',
    registradoEm: row.registrado_em ? new Date(row.registrado_em).toISOString() : null,
    arrecadacaoDescricao: row.arrecadacao_descricao || '',
    arrecadacaoTipo: row.arrecadacao_tipo || '',
  };
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
  if (espaco.sale_group && !leaders.has(espaco.id)) return 0;
  return espaco.valor != null ? Number(espaco.valor) : 0;
}

async function findPatrocinioVinculo(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT id, status, marketing_canal_id, marketing_campanha_id, marketing_criativo_id
     FROM arrecadacao
     WHERE evento_id = ? AND participante_id = ? AND tipo = 'patrocinio'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [eventoId, participanteId],
  );
  return rows[0] || null;
}

async function syncLinkedArrecadacaoStatus(pool, eventoId, participanteId, status, excludeId) {
  if (!participanteId || !eventoId) return;

  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const perdas = perdaStatuses(etapas);
  if (perdas.has(status)) return;

  const [siblings] = await pool.query(
    `SELECT id, tipo, espaco_id, status
     FROM arrecadacao
     WHERE evento_id = ? AND participante_id = ? AND id != ? AND tipo IN ('patrocinio', 'espaco')`,
    [eventoId, participanteId, excludeId],
  );

  for (const sib of siblings) {
    if (perdas.has(sib.status) || sib.status === status) continue;

    if (sib.tipo === 'espaco' && sib.espaco_id) {
      const espacoStatus = await espacoStatusForArrecadacao(pool, eventoId, status);
      await pool.query(
        `UPDATE espacos SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [espacoStatus, sib.espaco_id],
      );
    }

    await pool.query(
      `UPDATE arrecadacao SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [status, sib.id],
    );
  }
}

export async function syncArrecadacaoForGrupo(pool, grupoId) {
  const [grupoRows] = await pool.query(
    'SELECT evento_id FROM grupos_espacos WHERE id = ? LIMIT 1',
    [grupoId],
  );
  const eventoId = grupoRows[0]?.evento_id;
  if (!eventoId) return;

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
  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const perdas = perdaStatuses(etapas);

  for (const e of espacos) {
    if (!e.participante_id) continue;

    const valorTotal = valorEspacoParaArrecadacao(e, leaders);

    keepEspacoIds.push(e.id);
    const descricao = `${e.label || `Espaço ${e.numero}`} — ${e.grupo_nome}`;
    const grupoSuffix = e.sale_group ? ' · venda em grupo' : '';
    const patrocinio = await findPatrocinioVinculo(pool, eventoId, e.participante_id);
    const statusFromPatrocinio =
      patrocinio?.status && !perdas.has(patrocinio.status) ? patrocinio.status : null;
    const arrecadacaoStatus = statusFromPatrocinio || e.status;
    const espacoStatus = statusFromPatrocinio
      ? await espacoStatusForArrecadacao(pool, eventoId, statusFromPatrocinio)
      : e.status;

    const [existing] = await pool.query(
      'SELECT id, valor_pago, status FROM arrecadacao WHERE espaco_id = ? LIMIT 1',
      [e.id],
    );

    if (existing[0]?.status === 'perda') continue;

    if (existing[0]) {
      await pool.query(
        `UPDATE arrecadacao SET
           participante_id = ?, descricao = ?, valor_total = ?, status = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [e.participante_id, descricao + grupoSuffix, valorTotal, arrecadacaoStatus, existing[0].id],
      );
      if (espacoStatus !== e.status) {
        await pool.query(
          `UPDATE espacos SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [espacoStatus, e.id],
        );
      }
      if (
        patrocinio &&
        (patrocinio.marketing_canal_id ||
          patrocinio.marketing_campanha_id ||
          patrocinio.marketing_criativo_id)
      ) {
        await pool.query(
          `UPDATE arrecadacao SET
             marketing_canal_id = COALESCE(marketing_canal_id, ?),
             marketing_campanha_id = COALESCE(marketing_campanha_id, ?),
             marketing_criativo_id = COALESCE(marketing_criativo_id, ?)
           WHERE id = ?`,
          [
            patrocinio.marketing_canal_id,
            patrocinio.marketing_campanha_id,
            patrocinio.marketing_criativo_id,
            existing[0].id,
          ],
        );
      }
    } else {
      await pool.query(
        `INSERT INTO arrecadacao
           (evento_id, participante_id, tipo, status, espaco_id, descricao, valor_total, valor_pago,
            marketing_canal_id, marketing_campanha_id, marketing_criativo_id, updated_at)
         VALUES (?, ?, 'espaco', ?, ?, ?, ?, 0, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          eventoId,
          e.participante_id,
          arrecadacaoStatus,
          e.id,
          descricao + grupoSuffix,
          valorTotal,
          patrocinio?.marketing_canal_id ?? null,
          patrocinio?.marketing_campanha_id ?? null,
          patrocinio?.marketing_criativo_id ?? null,
        ],
      );
      if (espacoStatus !== e.status) {
        await pool.query(
          `UPDATE espacos SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [espacoStatus, e.id],
        );
      }
    }
  }

  if (keepEspacoIds.length === 0) {
    await pool.query(
      `DELETE a FROM arrecadacao a
       INNER JOIN espacos e ON e.id = a.espaco_id
       WHERE e.grupo_id = ? AND a.tipo = 'espaco' AND a.status != 'perda'`,
      [grupoId],
    );
    return;
  }

  const placeholders = keepEspacoIds.map(() => '?').join(', ');
  await pool.query(
    `DELETE a FROM arrecadacao a
     INNER JOIN espacos e ON e.id = a.espaco_id
     WHERE e.grupo_id = ? AND a.tipo = 'espaco' AND a.status != 'perda'
       AND a.espaco_id NOT IN (${placeholders})`,
    [grupoId, ...keepEspacoIds],
  );
}

export async function syncAllArrecadacaoFromEspacos(pool) {
  const [grupos] = await pool.query('SELECT id FROM grupos_espacos');
  for (const g of grupos) {
    await syncArrecadacaoForGrupo(pool, g.id);
  }
}

function scopeTipoClause(scope) {
  if (scope === 'artistico') return " AND a.tipo = 'artistico'";
  return " AND a.tipo IN ('espaco', 'patrocinio')";
}

const ARRECADACAO_SELECT = `
  SELECT a.id, a.participante_id, a.tipo, a.status, a.espaco_id, a.descricao,
         a.valor_total, a.valor_pago, a.obs, a.motivo_perda, a.motivo_perda_outro,
         a.marketing_canal_id, a.marketing_campanha_id, a.marketing_criativo_id,
         a.created_at, a.updated_at, p.nome AS participante_nome,
         e.tipo AS espaco_tipo, e.numero AS espaco_numero,
         ge.slug AS espaco_grupo_slug,
         mc.nome AS marketing_canal_nome,
         mcp.nome AS marketing_campanha_nome,
         mcr.nome AS marketing_criativo_nome
  FROM arrecadacao a
  JOIN participantes p ON p.id = a.participante_id
  LEFT JOIN espacos e ON e.id = a.espaco_id
  LEFT JOIN grupos_espacos ge ON ge.id = e.grupo_id
  LEFT JOIN marketing_canais mc ON mc.id = a.marketing_canal_id
  LEFT JOIN marketing_campanhas mcp ON mcp.id = a.marketing_campanha_id
  LEFT JOIN marketing_criativos mcr ON mcr.id = a.marketing_criativo_id`;

export async function listArrecadacao(pool, eventoId, { scope } = {}) {
  const [rows] = await pool.query(
    `${ARRECADACAO_SELECT}
     WHERE a.evento_id = ?${scopeTipoClause(scope)}
     ORDER BY p.nome, a.tipo, a.descricao`,
    [eventoId],
  );
  return rows.map(rowToArrecadacao);
}

function rowToEspacoDisponivel(row) {
  return {
    id: row.id,
    numero: row.numero,
    label: row.label || `Espaço ${row.numero}`,
    grupoNome: row.grupo_nome || '',
    grupoSlug: row.grupo_slug || '',
    custo: row.custo != null ? Number(row.custo) : null,
    valor: row.valor != null ? Number(row.valor) : null,
  };
}

export async function listEspacosDisponiveis(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT e.id, e.numero, e.label, e.custo, e.valor,
            g.nome AS grupo_nome, g.slug AS grupo_slug
     FROM espacos e
     JOIN grupos_espacos g ON g.id = e.grupo_id
     WHERE g.evento_id = ? AND e.participante_id IS NULL AND e.status = 'disp'
       AND (e.sale_group IS NULL OR e.sale_group = '')
     ORDER BY g.nome, e.numero`,
    [eventoId],
  );
  return rows.map(rowToEspacoDisponivel);
}

export async function findArrecadacaoById(pool, id) {
  const [rows] = await pool.query(`${ARRECADACAO_SELECT} WHERE a.id = ? LIMIT 1`, [id]);
  return rows[0] ? rowToArrecadacao(rows[0]) : null;
}

export async function findArrecadacaoByEspacoId(pool, espacoId) {
  const [rows] = await pool.query(`${ARRECADACAO_SELECT} WHERE a.espaco_id = ? LIMIT 1`, [espacoId]);
  return rows[0] ? rowToArrecadacao(rows[0]) : null;
}

export async function createPatrocinio(pool, eventoId, raw) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const participanteId = await resolveParticipanteFromBody(conn, raw);
    const valorTotal = parseMoney(raw.valorTotal ?? raw.valor_total, 'Valor total');
    const valorPago = parseMoney(raw.valorPago ?? raw.valor_pago ?? 0, 'Valor pago');
    const tipo = raw.tipo === 'artistico' ? 'artistico' : 'patrocinio';
    const descricaoPadrao = tipo === 'artistico' ? 'Artístico' : 'Patrocínio';
    const descricao = String(raw.descricao || descricaoPadrao).trim() || descricaoPadrao;
    const obs = String(raw.obs || '').trim();
    const status = parseStatus(raw.status, 'neg');

    const [result] = await conn.query(
      `INSERT INTO arrecadacao
         (evento_id, participante_id, tipo, status, espaco_id, descricao, valor_total, valor_pago, obs, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [eventoId, participanteId, tipo, status, descricao, valorTotal, valorPago, obs || null],
    );

    if (valorPago > 0) {
      await conn.query(
        `INSERT INTO arrecadacao_pagamentos (arrecadacao_id, participante_id, valor, obs)
         VALUES (?, ?, ?, ?)`,
        [result.insertId, participanteId, valorPago, 'Pagamento inicial no cadastro'],
      );
    }

    const proximoContato = raw.proximoContato ?? raw.proximo_contato;
    if (proximoContato) {
      await createTarefaContato(conn, eventoId, {
        participanteId,
        arrecadacaoId: result.insertId,
        proximoContato,
        obsProximoContato: raw.obsProximoContato ?? raw.obs_proximo_contato,
      });
    }

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
  const valorPago = existing.valorPago;

  if (valorTotal < valorPago) {
    throw Object.assign(
      new Error('Valor total não pode ser menor que o valor já pago'),
      { status: 400 },
    );
  }

  const obs = raw.obs !== undefined ? String(raw.obs || '').trim() : existing.obs;
  let descricao = existing.descricao;
  if ((existing.tipo === 'patrocinio' || existing.tipo === 'artistico') && raw.descricao !== undefined) {
    const padrao = existing.tipo === 'artistico' ? 'Artístico' : 'Patrocínio';
    descricao = String(raw.descricao || padrao).trim() || padrao;
  }

  let participanteId = existing.participanteId;
  const shouldUpdateParticipante =
    raw.participanteId != null ||
    raw.participanteNome ||
    raw.participanteInstagram != null ||
    raw.participante_instagram != null ||
    raw.participanteWhatsapp != null ||
    raw.participante_whatsapp != null ||
    raw.participanteSeguidores !== undefined ||
    raw.participante_seguidores !== undefined;

  if ((existing.tipo === 'patrocinio' || existing.tipo === 'artistico') && shouldUpdateParticipante) {
    const conn = await pool.getConnection();
    try {
      participanteId = await resolveParticipanteFromBody(conn, raw);
    } finally {
      conn.release();
    }
  }

  let status = existing.status;
  if (raw.status !== undefined) {
    status = parseStatus(raw.status, existing.status);
  }

  let tipo = existing.tipo;
  if (raw.tipo !== undefined) {
    const next = String(raw.tipo || '').trim();
    if (next !== 'patrocinio' && next !== 'artistico') {
      throw Object.assign(new Error('Tipo de lead inválido'), { status: 400 });
    }
    if (existing.tipo === 'espaco') {
      throw Object.assign(
        new Error('Registros de espaço não podem ser movidos para outro tipo'),
        { status: 400 },
      );
    }
    if (existing.tipo === 'patrocinio' || existing.tipo === 'artistico') {
      tipo = next;
      if (tipo === 'artistico' && existing.tipo === 'patrocinio' && descricao === 'Patrocínio') {
        descricao = 'Artístico';
      }
      if (tipo === 'patrocinio' && existing.tipo === 'artistico' && descricao === 'Artístico') {
        descricao = 'Patrocínio';
      }
    }
  }

  if (existing.tipo === 'espaco' && existing.espacoId) {
    const [eventoRows] = await pool.query('SELECT evento_id FROM arrecadacao WHERE id = ? LIMIT 1', [
      id,
    ]);
    const espacoStatus = await espacoStatusForArrecadacao(
      pool,
      eventoRows[0]?.evento_id,
      status,
    );
    const espacoSets = ['valor = ?', 'status = ?', 'updated_at = CURRENT_TIMESTAMP(3)'];
    const espacoParams = [valorTotal, espacoStatus];
    if (raw.espacoTipo !== undefined || raw.espaco_tipo !== undefined) {
      espacoSets.splice(2, 0, 'tipo = ?');
      espacoParams.push(String(raw.espacoTipo ?? raw.espaco_tipo ?? '').trim());
    }
    espacoParams.push(existing.espacoId);
    await pool.query(
      `UPDATE espacos SET ${espacoSets.join(', ')} WHERE id = ?`,
      espacoParams,
    );
  }

  let marketingCanalId = existing.marketingCanalId ?? null;
  let marketingCampanhaId = existing.marketingCampanhaId ?? null;
  let marketingCriativoId = existing.marketingCriativoId ?? null;

  if (raw.marketingCanalId !== undefined || raw.marketing_canal_id !== undefined) {
    const v = raw.marketingCanalId ?? raw.marketing_canal_id;
    marketingCanalId = v != null && v !== '' ? Number(v) : null;
    marketingCampanhaId = null;
    marketingCriativoId = null;
  }
  if (raw.marketingCampanhaId !== undefined || raw.marketing_campanha_id !== undefined) {
    const v = raw.marketingCampanhaId ?? raw.marketing_campanha_id;
    marketingCampanhaId = v != null && v !== '' ? Number(v) : null;
    marketingCriativoId = null;
  }
  if (raw.marketingCriativoId !== undefined || raw.marketing_criativo_id !== undefined) {
    const v = raw.marketingCriativoId ?? raw.marketing_criativo_id;
    marketingCriativoId = v != null && v !== '' ? Number(v) : null;
  }

  await pool.query(
    `UPDATE arrecadacao SET
       participante_id = ?, tipo = ?, descricao = ?, valor_total = ?, valor_pago = ?, obs = ?, status = ?,
       marketing_canal_id = ?, marketing_campanha_id = ?, marketing_criativo_id = ?,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [
      participanteId,
      tipo,
      descricao,
      valorTotal,
      valorPago,
      obs || null,
      status,
      marketingCanalId,
      marketingCampanhaId,
      marketingCriativoId,
      id,
    ],
  );

  if (raw.status !== undefined && status !== existing.status && participanteId) {
    const [eventoRows] = await pool.query('SELECT evento_id FROM arrecadacao WHERE id = ? LIMIT 1', [
      id,
    ]);
    await syncLinkedArrecadacaoStatus(
      pool,
      eventoRows[0]?.evento_id,
      participanteId,
      status,
      id,
    );
  }

  return findArrecadacaoById(pool, id);
}

export async function migrateArrecadacaoToArtistico(pool, id) {
  const existing = await findArrecadacaoById(pool, id);
  if (!existing) return null;
  if (existing.tipo === 'espaco') {
    throw Object.assign(
      new Error('Registros de espaço não podem ser movidos para Artístico'),
      { status: 400 },
    );
  }
  if (existing.tipo === 'artistico') return existing;
  return updateArrecadacao(pool, id, { tipo: 'artistico' });
}

function parseMotivoPerda(raw) {
  const motivo = String(raw.motivo ?? raw.motivoPerda ?? '').trim();
  if (!MOTIVOS_PERDA.has(motivo)) {
    throw Object.assign(new Error('Selecione o motivo da perda do lead'), { status: 400 });
  }
  const motivoOutro = String(raw.motivoOutro ?? raw.motivo_perda_outro ?? '').trim();
  if (motivo === 'outro' && !motivoOutro) {
    throw Object.assign(new Error('Descreva o motivo da perda'), { status: 400 });
  }
  return { motivo, motivoOutro: motivo === 'outro' ? motivoOutro : null };
}

export async function registerPerdaLead(pool, id, raw) {
  const existing = await findArrecadacaoById(pool, id);
  if (!existing) return null;

  const [eventoRows] = await pool.query('SELECT evento_id FROM arrecadacao WHERE id = ? LIMIT 1', [
    id,
  ]);
  const eventoId = eventoRows[0]?.evento_id;
  const escopo = funilEscopoForTipo(existing.tipo);
  const etapas = eventoId != null ? await listFunilEtapas(pool, eventoId, { escopo }) : [];
  if (isPerdaStatus(existing.status, etapas)) {
    throw Object.assign(new Error('Este registro já foi marcado como perda de lead'), {
      status: 400,
    });
  }

  const perdaStatus = perdaEtapa(etapas)?.status || 'perda';
  const { motivo, motivoOutro } = parseMotivoPerda(raw);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE arrecadacao SET
         status = ?, motivo_perda = ?, motivo_perda_outro = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [perdaStatus, motivo, motivoOutro, id],
    );

    if (existing.tipo === 'espaco' && existing.espacoId) {
      await conn.query(
        `UPDATE espacos SET
           status = 'disp', participante_id = NULL, client = '', valor = NULL,
           sale_group = '', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [existing.espacoId],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query(
    `SELECT a.id, a.participante_id, a.tipo, a.status, a.espaco_id, a.descricao,
            a.valor_total, a.valor_pago, a.obs, a.motivo_perda, a.motivo_perda_outro,
            a.created_at, a.updated_at, p.nome AS participante_nome
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToArrecadacao(rows[0]) : null;
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
  const novoParticipante = Boolean(raw.novoParticipante ?? raw.novo_participante);
  const id =
    !novoParticipante && raw.participanteId != null && raw.participanteId !== ''
      ? Number(raw.participanteId)
      : null;
  const nome = String(raw.participanteNome || raw.participante_nome || '').trim();
  if (!id && !nome) {
    throw Object.assign(new Error('Informe o participante ou patrocinador'), { status: 400 });
  }

  const instagram = raw.participanteInstagram ?? raw.participante_instagram;
  const contatoTelefone = raw.participanteWhatsapp ?? raw.participante_whatsapp;
  const seguidores = raw.participanteSeguidores ?? raw.participante_seguidores;
  const atualizarContato =
    novoParticipante ||
    instagram != null ||
    contatoTelefone != null ||
    seguidores !== undefined ||
    raw.participante_instagram != null ||
    raw.participante_whatsapp != null ||
    raw.participante_seguidores !== undefined;

  const participanteId = await ensureParticipante(conn, {
    id,
    nome,
    instagram: atualizarContato ? instagram : undefined,
    contatoTelefone: atualizarContato ? contatoTelefone : undefined,
    seguidores: atualizarContato ? seguidores : undefined,
  });
  if (!participanteId) {
    throw Object.assign(new Error('Participante inválido'), { status: 400 });
  }
  return participanteId;
}

export async function listPagamentosByArrecadacao(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.arrecadacao_id, p.participante_id, p.valor, p.obs, p.registrado_em,
            a.descricao AS arrecadacao_descricao, a.tipo AS arrecadacao_tipo
     FROM arrecadacao_pagamentos p
     JOIN arrecadacao a ON a.id = p.arrecadacao_id
     WHERE p.arrecadacao_id = ?
     ORDER BY p.registrado_em DESC, p.id DESC`,
    [arrecadacaoId],
  );
  return rows.map(rowToPagamento);
}

export async function listPagamentosByParticipante(pool, participanteId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.arrecadacao_id, p.participante_id, p.valor, p.obs, p.registrado_em,
            a.descricao AS arrecadacao_descricao, a.tipo AS arrecadacao_tipo
     FROM arrecadacao_pagamentos p
     JOIN arrecadacao a ON a.id = p.arrecadacao_id
     WHERE p.participante_id = ?
     ORDER BY p.registrado_em DESC, p.id DESC`,
    [participanteId],
  );
  return rows.map(rowToPagamento);
}

async function recalculateValorPago(conn, arrecadacaoId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(valor), 0) AS total
     FROM arrecadacao_pagamentos WHERE arrecadacao_id = ?`,
    [arrecadacaoId],
  );
  const total = Number(rows[0]?.total || 0);
  await conn.query(
    `UPDATE arrecadacao SET valor_pago = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [total, arrecadacaoId],
  );
  return total;
}

export async function deletePagamento(pool, arrecadacaoId, pagamentoId, eventoId = null) {
  const [pagamentoRows] = await pool.query(
    `SELECT p.id, p.arrecadacao_id, p.valor
     FROM arrecadacao_pagamentos p
     JOIN arrecadacao a ON a.id = p.arrecadacao_id
     WHERE p.id = ? AND p.arrecadacao_id = ?
       ${eventoId != null ? 'AND a.evento_id = ?' : ''}
     LIMIT 1`,
    eventoId != null ? [pagamentoId, arrecadacaoId, eventoId] : [pagamentoId, arrecadacaoId],
  );
  if (!pagamentoRows[0]) return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM arrecadacao_pagamentos WHERE id = ? AND arrecadacao_id = ?', [
      pagamentoId,
      arrecadacaoId,
    ]);
    await recalculateValorPago(conn, arrecadacaoId);
    await conn.commit();
    return { item: await findArrecadacaoById(pool, arrecadacaoId) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function registerPagamento(pool, arrecadacaoId, raw) {
  const existing = await findArrecadacaoById(pool, arrecadacaoId);
  if (!existing) return null;

  const valor = parseMoney(raw.valor ?? raw.valorPagamento, 'Valor do pagamento');
  if (valor <= 0) {
    throw Object.assign(new Error('Informe um valor de pagamento maior que zero'), { status: 400 });
  }

  const novoPago = existing.valorPago + valor;
  if (novoPago > existing.valorTotal) {
    throw Object.assign(
      new Error(
        `Pagamento excede o saldo. Falta pagar: ${(existing.valorTotal - existing.valorPago).toFixed(2)}`,
      ),
      { status: 400 },
    );
  }

  const obs = String(raw.obs || '').trim() || null;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO arrecadacao_pagamentos (arrecadacao_id, participante_id, valor, obs)
       VALUES (?, ?, ?, ?)`,
      [arrecadacaoId, existing.participanteId, valor, obs],
    );

    await conn.query(
      `UPDATE arrecadacao SET valor_pago = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [novoPago, arrecadacaoId],
    );

    await conn.commit();

    const [rows] = await conn.query(
      `SELECT p.id, p.arrecadacao_id, p.participante_id, p.valor, p.obs, p.registrado_em,
              a.descricao AS arrecadacao_descricao, a.tipo AS arrecadacao_tipo
       FROM arrecadacao_pagamentos p
       JOIN arrecadacao a ON a.id = p.arrecadacao_id
       WHERE p.id = ? LIMIT 1`,
      [result.insertId],
    );

    return {
      pagamento: rows[0] ? rowToPagamento(rows[0]) : null,
      item: await findArrecadacaoById(pool, arrecadacaoId),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function summarizeArrecadacao(items, etapas = []) {
  const perdas = perdaStatuses(etapas);
  let total = 0;
  let pago = 0;
  let count = 0;
  for (const item of items) {
    if (perdas.has(item.status)) continue;
    total += item.valorTotal;
    pago += item.valorPago;
    count += 1;
  }
  return {
    total,
    pago,
    falta: Math.max(0, total - pago),
    count,
  };
}

export async function findArrecadacaoForParticipante(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT id, tipo FROM arrecadacao
     WHERE evento_id = ? AND participante_id = ?
     ORDER BY CASE tipo WHEN 'contato' THEN 1 ELSE 0 END, id ASC
     LIMIT 1`,
    [eventoId, participanteId],
  );
  if (!rows[0]) return null;
  return { id: Number(rows[0].id), tipo: rows[0].tipo };
}

/** Garante vínculo de WhatsApp para contato sem lead comercial/artístico. */
export async function ensureWhatsappContatoArrecadacao(
  pool,
  eventoId,
  participanteId,
  { descricao = 'Contato' } = {},
) {
  const id = Number(participanteId);
  if (!Number.isInteger(id) || id < 1) return null;

  const existing = await findArrecadacaoForParticipante(pool, eventoId, id);
  if (existing) return existing.id;

  const label = String(descricao || 'Contato').trim() || 'Contato';
  const [result] = await pool.query(
    `INSERT INTO arrecadacao
       (evento_id, participante_id, tipo, status, descricao, valor_total, valor_pago, updated_at)
     VALUES (?, ?, 'contato', 'neg', ?, 0, 0, CURRENT_TIMESTAMP(3))`,
    [eventoId, id, label],
  );
  return Number(result.insertId);
}
