import { ESPACOS_SEED } from './data/espacos-seed.js';
import { PRACA_ALIMENTACAO_SEED } from './data/praca-alimentacao-seed.js';
import { EXPOSITORES_5X5_SEED } from './data/expositores-5x5-seed.js';
import { FEIRA_COMERCIAL_2_SEED } from './data/feira-comercial-2-seed.js';
import { migrateGrupos, findGrupoBySlug } from './grupos.js';
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

const VALID_STATUS = new Set(['disp', 'neg', 'res', 'vend']);

function rowToSpace(row) {
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

async function seedGrupoSpaces(pool, grupoId, seeds) {
  const [rows] = await pool.query('SELECT numero FROM espacos WHERE grupo_id = ?', [grupoId]);
  const existing = new Set(rows.map((r) => r.numero));

  for (const seed of seeds) {
    const custo = seed.custo != null ? Number(seed.custo) : null;
    if (existing.has(seed.id)) {
      await pool.query(
        `UPDATE espacos SET
           label = COALESCE(NULLIF(label, ''), ?),
           points = COALESCE(NULLIF(points, ''), ?),
           custo = COALESCE(custo, ?)
         WHERE grupo_id = ? AND numero = ?`,
        [seed.label, seed.points, custo, grupoId, seed.id],
      );
    } else {
      await pool.query(
        `INSERT INTO espacos (grupo_id, numero, label, points, status, tipo, client, obs, custo, sale_group, valor, updated_at)
         VALUES (?, ?, ?, ?, 'disp', '', '', NULL, ?, '', NULL, NULL)`,
        [grupoId, seed.id, seed.label, seed.points, custo],
      );
    }
  }
}

export async function migrateEspacos(pool) {
  await migrateGrupos(pool);

  const feira1 = await findGrupoBySlug(pool, 'feira-comercial-1');
  if (!feira1) throw new Error('Grupo feira-comercial-1 não encontrado');

  const migrated = await migrateLegacyEspacos(pool, feira1.id);
  if (!migrated) {
    await createEspacosTable(pool);
  }

  await ensureCustoColumn(pool);

  await seedGrupoSpaces(pool, feira1.id, ESPACOS_SEED);

  const feira2 = await findGrupoBySlug(pool, 'feira-comercial-2');
  if (feira2) {
    await seedGrupoSpaces(pool, feira2.id, FEIRA_COMERCIAL_2_SEED);
  }

  const praca = await findGrupoBySlug(pool, 'praca-alimentacao');
  if (praca) {
    await seedGrupoSpaces(pool, praca.id, PRACA_ALIMENTACAO_SEED);
  }

  const expositores = await findGrupoBySlug(pool, 'expositores-5x5');
  if (expositores) {
    await seedGrupoSpaces(pool, expositores.id, EXPOSITORES_5X5_SEED);
  }
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

export async function fetchSpacesByGrupo(pool, grupoSlug) {
  const grupo = await findGrupoBySlug(pool, grupoSlug);
  if (!grupo) {
    throw Object.assign(new Error('Agrupamento não encontrado'), { status: 404 });
  }

  const [rows] = await pool.query(
    `SELECT e.id, e.numero, e.label, e.points, e.status, e.tipo, e.client, e.participante_id,
            e.obs, e.custo, e.valor, e.sale_group, e.updated_at,
            p.nome AS participante_nome
     FROM espacos e
     LEFT JOIN participantes p ON p.id = e.participante_id
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

export async function upsertSpaces(pool, grupoSlug, updates) {
  const grupo = await findGrupoBySlug(pool, grupoSlug);
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
      const points = existing[0]?.points || seed?.points || '';
      const custo = resolveCusto(raw, existing[0]?.custo);
      const participanteId = await resolveParticipanteId(
        conn,
        raw,
        existing[0]?.participante_id,
      );

      if (existing[0]) {
        await conn.query(
          `UPDATE espacos SET
             status = ?, tipo = ?, client = ?, participante_id = ?, obs = ?, custo = ?, valor = ?, sale_group = ?, updated_at = ?
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
