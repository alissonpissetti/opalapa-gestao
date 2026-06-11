import { TIPOS_COMERCIO_SEED } from './data/espacos-seed.js';

export async function migrateTiposComercio(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tipos_comercio (
      id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      UNIQUE KEY uq_tipos_nome (nome)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM tipos_comercio');
  if (rows[0].n > 0) return;

  const values = TIPOS_COMERCIO_SEED.map((nome, i) => [nome, i + 1]);
  await pool.query('INSERT INTO tipos_comercio (nome, sort_order) VALUES ?', [values]);
}

export async function fetchTiposComercio(pool) {
  const [rows] = await pool.query('SELECT nome FROM tipos_comercio ORDER BY nome ASC');
  return rows.map((r) => r.nome);
}

export async function ensureTipoComercio(pool, nome) {
  const trimmed = String(nome || '').trim();
  if (!trimmed) return false;

  const [existing] = await pool.query(
    'SELECT id FROM tipos_comercio WHERE LOWER(nome) = LOWER(?) LIMIT 1',
    [trimmed],
  );
  if (existing.length > 0) return false;

  await pool.query('INSERT INTO tipos_comercio (nome, sort_order) VALUES (?, 0)', [trimmed]);
  return true;
}

export async function ensureTiposComercio(pool, nomes) {
  const seen = new Set();
  let created = false;
  for (const nome of nomes) {
    const trimmed = String(nome || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (await ensureTipoComercio(pool, trimmed)) created = true;
  }
  return created;
}
