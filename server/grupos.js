import { GRUPOS_SEED } from './data/grupos-seed.js';

function rowToGrupo(row) {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    mapImage: row.map_image || '',
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    sortOrder: row.sort_order,
  };
}

export async function migrateGrupos(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos_espacos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL,
      nome VARCHAR(100) NOT NULL,
      map_image VARCHAR(255) NOT NULL DEFAULT '',
      map_width INT UNSIGNED NOT NULL DEFAULT 1392,
      map_height INT UNSIGNED NOT NULL DEFAULT 712,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      UNIQUE KEY uq_grupos_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const seed of GRUPOS_SEED) {
    await pool.query(
      `INSERT INTO grupos_espacos (slug, nome, map_image, map_width, map_height, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nome = VALUES(nome),
         map_image = VALUES(map_image),
         map_width = VALUES(map_width),
         map_height = VALUES(map_height),
         sort_order = VALUES(sort_order)`,
      [seed.slug, seed.nome, seed.mapImage, seed.mapWidth, seed.mapHeight, seed.sortOrder],
    );
  }
}

export async function fetchGrupos(pool) {
  const [rows] = await pool.query(
    `SELECT g.id, g.slug, g.nome, g.map_image, g.map_width, g.map_height, g.sort_order,
            COUNT(e.id) AS total
     FROM grupos_espacos g
     LEFT JOIN espacos e ON e.grupo_id = g.id
     GROUP BY g.id
     ORDER BY g.sort_order, g.nome`,
  );
  return rows.map((row) => ({
    ...rowToGrupo(row),
    total: Number(row.total),
  }));
}

export async function findGrupoBySlug(pool, slug) {
  const [rows] = await pool.query(
    `SELECT id, slug, nome, map_image, map_width, map_height, sort_order
     FROM grupos_espacos WHERE slug = ? LIMIT 1`,
    [slug],
  );
  return rows[0] ? rowToGrupo(rows[0]) : null;
}
