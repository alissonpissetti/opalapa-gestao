import { ESPACOS_SEED } from './data/espacos-seed.js';
import { PRACA_ALIMENTACAO_SEED } from './data/praca-alimentacao-seed.js';
import { EXPOSITORES_5X5_SEED } from './data/expositores-5x5-seed.js';
import { FEIRA_COMERCIAL_2_SEED } from './data/feira-comercial-2-seed.js';
import { migrateGrupos, ensureGruposForEvento, findGrupoBySlug } from './grupos.js';
import { GRUPOS_SEED } from './data/grupos-seed.js';
import { resolveParticipanteId } from './participantes.js';
import { syncArrecadacaoForGrupo } from './arrecadacao.js';

const SEEDS_BY_SLUG = {
  'feira-comercial-1': ESPACOS_SEED,
  'praca-alimentacao': PRACA_ALIMENTACAO_SEED,
  'expositores-5x5': EXPOSITORES_5X5_SEED,
  'feira-comercial-2': FEIRA_COMERCIAL_2_SEED,
};

function getSeedForGrupo(slug, numero) {
  return SEEDS_BY_SLUG[slug]?.find((s) => s.id === numero);
}

const VALID_STATUS = new Set(['disp', 'lead', 'neg', 'res', 'vend']);

const ACTIVE_STATUSES = new Set(['lead', 'neg', 'res', 'vend']);

function isSaleGroupNonLeader(row) {
  if (!row.sale_group) return false;
  const espacoValor = row.valor != null && row.valor !== '' ? Number(row.valor) : null;
  const arrTotal =
    row.arrecadacao_valor_total != null && row.arrecadacao_valor_total !== ''
      ? Number(row.arrecadacao_valor_total)
      : null;
  return espacoValor != null && espacoValor > 0 && arrTotal === 0;
}

function resolvePaymentFields(row) {
  if (isSaleGroupNonLeader(row)) {
    return { valorPago: null, valorFalta: null };
  }

  const espacoValor = row.valor != null && row.valor !== '' ? Number(row.valor) : null;
  const temArrecadacao =
    row.arrecadacao_id != null ||
    (row.arrecadacao_valor_total != null && row.arrecadacao_valor_total !== '') ||
    (row.valor_pago != null && row.valor_pago !== '');

  let valorTotal =
    row.arrecadacao_valor_total != null && row.arrecadacao_valor_total !== ''
      ? Number(row.arrecadacao_valor_total)
      : null;
  let valorPago =
    row.valor_pago != null && row.valor_pago !== '' ? Number(row.valor_pago) : null;

  const ocupado = ACTIVE_STATUSES.has(row.status);
  const temParticipante = row.participante_id != null;

  if (ocupado && temParticipante) {
    if ((valorTotal == null || Number.isNaN(valorTotal)) && espacoValor != null && !Number.isNaN(espacoValor)) {
      valorTotal = espacoValor;
    }
    if (valorPago == null || Number.isNaN(valorPago)) {
      valorPago = temArrecadacao || valorTotal != null ? 0 : null;
    }
  }

  if (valorTotal == null || Number.isNaN(valorTotal) || valorPago == null || Number.isNaN(valorPago)) {
    return { valorPago: null, valorFalta: null };
  }

  return {
    valorPago,
    valorFalta: Math.max(0, valorTotal - valorPago),
  };
}

function rowToSpace(row) {
  const { valorPago, valorFalta } = resolvePaymentFields(row);

  return {
    id: row.id,
    numero: row.numero,
    label: row.label || `Espaço ${row.numero}`,
    points: row.points || '',
    status: row.status,
    tipo: row.tipo || '',
    client: row.client || '',
    participanteId: row.participante_id != null ? Number(row.participante_id) : null,
    participanteNome: row.participante_nome || '',
    obs: row.obs || '',
    custo: row.custo != null ? Number(row.custo) : null,
    valor: row.valor != null ? Number(row.valor) : null,
    valorPago,
    valorFalta,
    saleGroup: row.sale_group || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export function defaultSpaceData(numero) {
  return {
    numero,
    label: `Espaço ${numero}`,
    points: '',
    status: 'disp',
    tipo: '',
    client: '',
    participanteId: null,
    participanteNome: '',
    obs: '',
    custo: null,
    valor: null,
    saleGroup: '',
    updatedAt: null,
  };
}

async function createEspacosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS espacos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      grupo_id INT UNSIGNED NOT NULL,
      numero SMALLINT UNSIGNED NOT NULL,
      label VARCHAR(100) NOT NULL DEFAULT '',
      points TEXT NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'disp',
      tipo VARCHAR(100) NOT NULL DEFAULT '',
      client VARCHAR(255) NOT NULL DEFAULT '',
      obs TEXT,
      custo DECIMAL(12, 2) NULL,
      valor DECIMAL(12, 2) NULL,
      sale_group VARCHAR(100) NOT NULL DEFAULT '',
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_grupo_numero (grupo_id, numero),
      INDEX idx_grupo (grupo_id),
      INDEX idx_status (status),
      INDEX idx_sale_group (sale_group),
      CONSTRAINT fk_espacos_grupo FOREIGN KEY (grupo_id) REFERENCES grupos_espacos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function migrateLegacyEspacos(pool, feira1Id) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'espacos'`,
  );

  if (cols.length === 0) return false;

  const names = new Set(cols.map((c) => c.COLUMN_NAME));
  if (names.has('grupo_id')) return false;

  await pool.query(`
    CREATE TABLE espacos_new (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      grupo_id INT UNSIGNED NOT NULL,
      numero SMALLINT UNSIGNED NOT NULL,
      label VARCHAR(100) NOT NULL DEFAULT '',
      points TEXT NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'disp',
      tipo VARCHAR(100) NOT NULL DEFAULT '',
      client VARCHAR(255) NOT NULL DEFAULT '',
      obs TEXT,
      custo DECIMAL(12, 2) NULL,
      valor DECIMAL(12, 2) NULL,
      sale_group VARCHAR(100) NOT NULL DEFAULT '',
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_grupo_numero (grupo_id, numero),
      INDEX idx_grupo (grupo_id),
      INDEX idx_status (status),
      CONSTRAINT fk_espacos_grupo FOREIGN KEY (grupo_id) REFERENCES grupos_espacos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(
    `INSERT INTO espacos_new (grupo_id, numero, label, points, status, tipo, client, obs, valor, sale_group, updated_at)
     SELECT ?, id, label, COALESCE(points, ''), status, tipo, client, obs, valor, sale_group, updated_at
     FROM espacos`,
    [feira1Id],
  );

  await pool.query('DROP TABLE espacos');
  await pool.query('RENAME TABLE espacos_new TO espacos');
  return true;
}

async function seedGrupoSpaces(pool, grupoId, seeds, { resetPoints = false } = {}) {
  const [rows] = await pool.query('SELECT numero FROM espacos WHERE grupo_id = ?', [grupoId]);
  const existing = new Set(rows.map((r) => r.numero));

  for (const seed of seeds) {
    const custo = seed.custo != null ? Number(seed.custo) : null;
    const seedPoints = seed.points ?? '';
    if (existing.has(seed.id)) {
      await pool.query(
        `UPDATE espacos SET
           label = COALESCE(NULLIF(label, ''), ?),
           points = ${resetPoints ? '?' : "COALESCE(NULLIF(points, ''), ?)"},
           custo = COALESCE(custo, ?)
         WHERE grupo_id = ? AND numero = ?`,
        resetPoints
          ? [seed.label, seedPoints, custo, grupoId, seed.id]
          : [seed.label, seedPoints, custo, grupoId, seed.id],
      );
    } else {
      await pool.query(
        `INSERT INTO espacos (grupo_id, numero, label, points, status, tipo, client, obs, custo, sale_group, valor, updated_at)
         VALUES (?, ?, ?, ?, 'disp', '', '', NULL, ?, '', NULL, NULL)`,
        [grupoId, seed.id, seed.label, seedPoints, custo],
      );
    }
  }

  const seedIds = seeds.map((s) => s.id);
  if (seedIds.length) {
    await pool.query(
      `DELETE FROM espacos WHERE grupo_id = ? AND numero NOT IN (${seedIds.map(() => '?').join(', ')})`,
      [grupoId, ...seedIds],
    );
  }
}

async function getDefaultEventoId(pool) {
  const [rows] = await pool.query('SELECT id FROM eventos ORDER BY edicao ASC LIMIT 1');
  if (!rows[0]) throw new Error('Nenhum evento configurado');
  return rows[0].id;
}

export async function seedEspacosForEvento(pool, eventoId) {
  const mapImageChanged = new Map();
  for (const grupoSeed of GRUPOS_SEED) {
    const existing = await findGrupoBySlug(pool, grupoSeed.slug, eventoId);
    if (existing && existing.mapImage !== grupoSeed.mapImage) {
      mapImageChanged.set(grupoSeed.slug, true);
    }
  }

  await ensureGruposForEvento(pool, eventoId);

  const seeds = [
    ['feira-comercial-1', ESPACOS_SEED],
    ['feira-comercial-2', FEIRA_COMERCIAL_2_SEED],
    ['praca-alimentacao', PRACA_ALIMENTACAO_SEED],
    ['expositores-5x5', EXPOSITORES_5X5_SEED],
  ];

  for (const [slug, data] of seeds) {
    const grupo = await findGrupoBySlug(pool, slug, eventoId);
    if (grupo) {
      await seedGrupoSpaces(pool, grupo.id, data, { resetPoints: mapImageChanged.get(slug) === true });
    }
  }
}

export async function migrateEspacos(pool) {
  await migrateGrupos(pool);

  const eventoId = await getDefaultEventoId(pool);
  const feira1 = await findGrupoBySlug(pool, 'feira-comercial-1', eventoId);

  const migrated = feira1 ? await migrateLegacyEspacos(pool, feira1.id) : false;
  if (!migrated) {
    await createEspacosTable(pool);
  }

  await ensureCustoColumn(pool);
  await seedEspacosForEvento(pool, eventoId);
}

async function ensureCustoColumn(pool) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'espacos' AND COLUMN_NAME = 'custo'`,
  );
  if (cols.length === 0) {
    await pool.query('ALTER TABLE espacos ADD COLUMN custo DECIMAL(12, 2) NULL AFTER obs');
  }
}

function parseMoneyField(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw Object.assign(new Error('Valor monetário inválido'), { status: 400 });
  }
  return n;
}

function resolvePoints(item, existingPoints, seedPoints) {
  if ('points' in item) return String(item.points ?? '').trim();
  return existingPoints || seedPoints || '';
}

function resolveCusto(item, existingCusto) {
  if (!('custo' in item)) {
    return existingCusto != null ? Number(existingCusto) : null;
  }
  return parseMoneyField(item.custo);
}

export function normalizeSpaceUpdate(item) {
  const numero = Number(item.numero ?? item.id);
  if (!Number.isInteger(numero) || numero < 1) {
    throw Object.assign(new Error(`Número de espaço inválido: ${item.numero ?? item.id}`), { status: 400 });
  }

  const status = String(item.status || 'disp');
  if (!VALID_STATUS.has(status)) {
    throw Object.assign(new Error(`Status inválido: ${status}`), { status: 400 });
  }

  const valor = item.valor != null && item.valor !== '' ? Number(item.valor) : null;
  if (valor != null && Number.isNaN(valor)) {
    throw Object.assign(new Error('Valor inválido'), { status: 400 });
  }

  return {
    numero,
    status,
    tipo: String(item.tipo || '').trim(),
    client: String(item.client || '').trim(),
    obs: String(item.obs || '').trim(),
    valor,
    saleGroup: String(item.saleGroup || '').trim(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

export async function fetchSpacesByGrupo(pool, grupoSlug, eventoId) {
  const grupo = await findGrupoBySlug(pool, grupoSlug, eventoId);
  if (!grupo) {
    throw Object.assign(new Error('Agrupamento não encontrado'), { status: 404 });
  }

  // Garante registro em arrecadacao para espaços com participante (valor_pago / valor_total).
  await syncArrecadacaoForGrupo(pool, grupo.id);

  const [rows] = await pool.query(
    `SELECT e.id, e.numero, e.label, e.points, e.status, e.tipo, e.client, e.participante_id,
            e.obs, e.custo, e.valor, e.sale_group, e.updated_at,
            p.nome AS participante_nome,
            a.id AS arrecadacao_id,
            a.valor_total AS arrecadacao_valor_total,
            a.valor_pago
     FROM espacos e
     LEFT JOIN participantes p ON p.id = e.participante_id
     LEFT JOIN arrecadacao a ON a.espaco_id = e.id AND a.tipo = 'espaco' AND a.status != 'perda'
     WHERE e.grupo_id = ? ORDER BY e.numero`,
    [grupo.id],
  );

  const spaces = {};
  for (const row of rows) {
    const space = rowToSpace(row);
    spaces[space.numero] = space;
  }

  return { grupo, spaces };
}

export async function upsertSpaces(pool, grupoSlug, updates, eventoId) {
  const grupo = await findGrupoBySlug(pool, grupoSlug, eventoId);
  if (!grupo) {
    throw Object.assign(new Error('Agrupamento não encontrado'), { status: 404 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const raw of updates) {
      const data = normalizeSpaceUpdate(raw);
      const [existing] = await conn.query(
        'SELECT id, label, points, custo, participante_id FROM espacos WHERE grupo_id = ? AND numero = ?',
        [grupo.id, data.numero],
      );

      const seed = getSeedForGrupo(grupoSlug, data.numero);
      const label = existing[0]?.label || seed?.label || `Espaço ${data.numero}`;
      const points = resolvePoints(raw, existing[0]?.points, seed?.points);
      const custo = resolveCusto(raw, existing[0]?.custo);
      const participanteId = await resolveParticipanteId(
        conn,
        raw,
        existing[0]?.participante_id,
      );

      if (existing[0]) {
        await conn.query(
          `UPDATE espacos SET
             status = ?, tipo = ?, client = ?, participante_id = ?, obs = ?, custo = ?, valor = ?, sale_group = ?, points = ?, updated_at = ?
           WHERE id = ?`,
          [
            data.status,
            data.tipo,
            data.client,
            participanteId,
            data.obs || null,
            custo,
            data.valor,
            data.saleGroup,
            points,
            new Date(data.updatedAt),
            existing[0].id,
          ],
        );
      } else {
        await conn.query(
          `INSERT INTO espacos (grupo_id, numero, label, points, status, tipo, client, participante_id, obs, custo, valor, sale_group, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            grupo.id,
            data.numero,
            label,
            points,
            data.status,
            data.tipo,
            data.client,
            participanteId,
            data.obs || null,
            custo,
            data.valor,
            data.saleGroup,
            new Date(data.updatedAt),
          ],
        );
      }
    }

    await conn.commit();
    await syncArrecadacaoForGrupo(pool, grupo.id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function moveEspacosReservas(pool, grupoSlug, rawBody, eventoId) {
  const movimentos = rawBody?.movimentos;
  if (!Array.isArray(movimentos) || movimentos.length === 0) {
    throw Object.assign(new Error('Informe ao menos um movimento'), { status: 400 });
  }

  const grupo = await findGrupoBySlug(pool, grupoSlug, eventoId);
  if (!grupo) {
    throw Object.assign(new Error('Agrupamento não encontrado'), { status: 404 });
  }

  const pairs = movimentos.map((m) => {
    const origem = Number(m.origemNumero);
    const destino = Number(m.destinoNumero);
    const destinoGrupoSlug = String(m.destinoGrupoSlug || grupoSlug).trim();
    if (!Number.isInteger(origem) || origem < 1) {
      throw Object.assign(new Error('Espaço de origem inválido'), { status: 400 });
    }
    if (!Number.isInteger(destino) || destino < 1) {
      throw Object.assign(new Error('Espaço de destino inválido'), { status: 400 });
    }
    if (destinoGrupoSlug === grupoSlug && origem === destino) {
      throw Object.assign(new Error('Selecione um espaço de destino diferente da origem'), {
        status: 400,
      });
    }
    return { origem, destino, destinoGrupoSlug };
  });

  const origemNums = new Set();
  const destKeys = new Set();
  for (const p of pairs) {
    if (origemNums.has(p.origem)) {
      throw Object.assign(new Error('Cada espaço de origem só pode ser movido uma vez'), {
        status: 400,
      });
    }
    origemNums.add(p.origem);
    const dk = `${p.destinoGrupoSlug}:${p.destino}`;
    if (destKeys.has(dk)) {
      throw Object.assign(new Error('Cada espaço de destino só pode ser usado uma vez'), {
        status: 400,
      });
    }
    destKeys.add(dk);
  }

  const data = normalizeSpaceUpdate({
    ...rawBody,
    numero: pairs[0].destino,
  });
  const now = new Date(data.updatedAt);

  const conn = await pool.getConnection();
  const grupoCache = new Map([[grupoSlug, grupo]]);
  const affectedGrupoIds = new Set([grupo.id]);

  async function getGrupo(slug) {
    if (grupoCache.has(slug)) return grupoCache.get(slug);
    const g = await findGrupoBySlug(pool, slug, eventoId);
    if (!g) {
      throw Object.assign(new Error(`Agrupamento "${slug}" não encontrado`), { status: 404 });
    }
    grupoCache.set(slug, g);
    return g;
  }

  try {
    await conn.beginTransaction();

    const origemPlaceholders = [...origemNums].map(() => '?').join(', ');
    const [origemRows] = await conn.query(
      `SELECT e.id, e.numero, e.label, e.status, e.sale_group, e.participante_id, e.custo, e.valor
       FROM espacos e
       WHERE e.grupo_id = ? AND e.numero IN (${origemPlaceholders})
       FOR UPDATE`,
      [grupo.id, ...origemNums],
    );
    if (origemRows.length !== pairs.length) {
      throw Object.assign(new Error('Um ou mais espaços de origem não foram encontrados'), {
        status: 404,
      });
    }

    const origemByNum = new Map(origemRows.map((r) => [r.numero, r]));
    const saleGroups = new Set(origemRows.filter((r) => r.sale_group).map((r) => r.sale_group));
    if (saleGroups.size > 1) {
      throw Object.assign(
        new Error('Não é possível mover espaços de vendas em grupo diferentes ao mesmo tempo'),
        { status: 400 },
      );
    }

    const saleGroup = saleGroups.size === 1 ? [...saleGroups][0] : '';
    const isGroupSale = Boolean(saleGroup);

    if (isGroupSale) {
      const [fullGroupRows] = await conn.query(
        `SELECT numero FROM espacos WHERE grupo_id = ? AND sale_group = ?`,
        [grupo.id, saleGroup],
      );
      const fullNums = new Set(fullGroupRows.map((r) => r.numero));
      if (fullNums.size !== origemNums.size || [...fullNums].some((n) => !origemNums.has(n))) {
        throw Object.assign(
          new Error('Para venda em grupo, mova todos os espaços do grupo de uma vez'),
          { status: 400 },
        );
      }
    } else if (origemRows.some((r) => r.sale_group)) {
      throw Object.assign(
        new Error('Inclua todos os espaços da mesma venda em grupo para mover'),
        { status: 400 },
      );
    }

    for (const row of origemRows) {
      if (!ACTIVE_STATUSES.has(row.status)) {
        throw Object.assign(new Error('Só é possível mover reservas de espaços ocupados'), {
          status: 400,
        });
      }
    }

    const participanteId = await resolveParticipanteId(
      conn,
      rawBody,
      origemRows[0].participante_id,
    );
    if (!participanteId) {
      throw Object.assign(new Error('Informe o participante da reserva'), { status: 400 });
    }

    const origemLeader = Math.min(...origemRows.map((r) => r.numero));

    for (const pair of pairs) {
      const origemEspaco = origemByNum.get(pair.origem);
      const destinoGrupo = await getGrupo(pair.destinoGrupoSlug);
      affectedGrupoIds.add(destinoGrupo.id);

      const [destinoRows] = await conn.query(
        `SELECT id, numero, label, status, participante_id, sale_group
         FROM espacos WHERE grupo_id = ? AND numero = ? FOR UPDATE`,
        [destinoGrupo.id, pair.destino],
      );
      const destinoEspaco = destinoRows[0];
      if (!destinoEspaco) {
        throw Object.assign(new Error(`Espaço de destino ${pair.destino} não encontrado`), {
          status: 404,
        });
      }
      if (destinoEspaco.status !== 'disp' || destinoEspaco.participante_id) {
        throw Object.assign(new Error('O espaço de destino precisa estar disponível'), {
          status: 400,
        });
      }
      if (destinoEspaco.sale_group) {
        throw Object.assign(
          new Error('O espaço de destino não pode fazer parte de outra venda em grupo'),
          { status: 400 },
        );
      }

      let valor = origemEspaco.valor;
      if (isGroupSale) {
        valor =
          origemEspaco.numero === origemLeader ? (data.valor ?? origemEspaco.valor) : null;
      } else if (pairs.length === 1) {
        valor = data.valor ?? origemEspaco.valor;
      }

      await conn.query(
        `UPDATE espacos SET
           status = ?, tipo = ?, client = ?, participante_id = ?, obs = ?, valor = ?, custo = ?,
           sale_group = ?, updated_at = ?
         WHERE id = ?`,
        [
          data.status,
          data.tipo,
          data.client,
          participanteId,
          data.obs || null,
          valor,
          origemEspaco.custo,
          isGroupSale ? saleGroup : '',
          now,
          destinoEspaco.id,
        ],
      );

      await conn.query(
        `UPDATE espacos SET
           status = 'disp', tipo = '', client = '', participante_id = NULL, obs = NULL,
           valor = NULL, sale_group = '', updated_at = ?
         WHERE id = ?`,
        [now, origemEspaco.id],
      );
    }

    await conn.commit();
    for (const grupoId of affectedGrupoIds) {
      await syncArrecadacaoForGrupo(pool, grupoId);
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function moveEspacoReserva(pool, grupoSlug, origemNumero, rawDestino, eventoId) {
  const destinoGrupoSlug = String(rawDestino?.destinoGrupoSlug || grupoSlug).trim();
  const destinoNumero = Number(rawDestino?.destinoNumero ?? rawDestino?.numero);
  return moveEspacosReservas(
    pool,
    grupoSlug,
    {
      ...rawDestino,
      movimentos: [{ origemNumero: Number(origemNumero), destinoGrupoSlug, destinoNumero }],
    },
    eventoId,
  );
}
