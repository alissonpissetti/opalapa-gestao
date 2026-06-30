export const PERMISSION_CATALOG = [
  { key: 'eventos', label: 'Eventos', area: 'Geral' },
  { key: 'espacos', label: 'Espaços', area: 'Comercial' },
  { key: 'arrecadacao', label: 'Arrecadação', area: 'Comercial' },
  { key: 'artistico', label: 'Artístico', area: 'Artístico' },
  { key: 'tarefas', label: 'Tarefas', area: 'Operacional' },
  { key: 'marketing', label: 'Marketing', area: 'Operacional' },
  { key: 'cronologia', label: 'Cronologia', area: 'Produção' },
  { key: 'premiacoes', label: 'Premiações', area: 'Produção' },
  { key: 'financeiro-gestao', label: 'Gestão financeira', area: 'Financeiro' },
  { key: 'financeiro-contas-pagar', label: 'Contas a pagar', area: 'Financeiro' },
  { key: 'usuarios', label: 'Usuários', area: 'Acessos' },
  { key: 'permissoes', label: 'Grupos de permissão', area: 'Acessos' },
];

export const ALL_VIEW_KEYS = PERMISSION_CATALOG.map((item) => item.key);

/** Telas cujo fluxo usa conversas WhatsApp com participantes/leads. */
export const WHATSAPP_VIEWS = [
  'espacos',
  'arrecadacao',
  'artistico',
  'tarefas',
  'marketing',
  'cronologia',
  'premiacoes',
  'financeiro-gestao',
];

const ADMIN_GROUP_NAME = 'Administrador';

function rowToGroup(row, views = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    isSystem: Boolean(row.is_system),
    userCount: Number(row.user_count || 0),
    views,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function normalizeViews(rawViews) {
  if (!Array.isArray(rawViews)) return [];
  const allowed = new Set(ALL_VIEW_KEYS);
  return [...new Set(rawViews.map((v) => String(v).trim()).filter((v) => allowed.has(v)))];
}

async function fetchGroupViews(pool, groupIds) {
  if (!groupIds.length) return new Map();
  const placeholders = groupIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT group_id, view_key FROM permission_group_views WHERE group_id IN (${placeholders})`,
    groupIds,
  );
  const map = new Map();
  for (const row of rows) {
    const id = Number(row.group_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row.view_key);
  }
  return map;
}

export async function migratePermissions(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permission_groups (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NULL,
      is_system TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_permission_groups_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS permission_group_views (
      group_id INT UNSIGNED NOT NULL,
      view_key VARCHAR(50) NOT NULL,
      PRIMARY KEY (group_id, view_key),
      CONSTRAINT fk_pgv_group FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [userCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'permission_group_id'`,
  );
  if (!userCols.length) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN permission_group_id INT UNSIGNED NULL,
      ADD INDEX idx_users_permission_group (permission_group_id),
      ADD CONSTRAINT fk_users_permission_group
        FOREIGN KEY (permission_group_id) REFERENCES permission_groups(id) ON DELETE SET NULL
    `);
  }

  const [adminRows] = await pool.query(
    'SELECT id FROM permission_groups WHERE is_system = 1 LIMIT 1',
  );
  let adminGroupId = adminRows[0]?.id;
  if (!adminGroupId) {
    const [result] = await pool.query(
      'INSERT INTO permission_groups (name, description, is_system) VALUES (?, ?, 1)',
      [ADMIN_GROUP_NAME, 'Acesso total a todas as áreas do sistema'],
    );
    adminGroupId = result.insertId;
    const values = ALL_VIEW_KEYS.map((viewKey) => [adminGroupId, viewKey]);
    for (const [groupId, viewKey] of values) {
      await pool.query(
        'INSERT INTO permission_group_views (group_id, view_key) VALUES (?, ?)',
        [groupId, viewKey],
      );
    }
  }

  await pool.query('UPDATE users SET permission_group_id = ? WHERE permission_group_id IS NULL', [
    adminGroupId,
  ]);

  for (const viewKey of ALL_VIEW_KEYS) {
    await pool.query(
      'INSERT IGNORE INTO permission_group_views (group_id, view_key) VALUES (?, ?)',
      [adminGroupId, viewKey],
    );
  }
}

export async function getUserAccess(pool, userId) {
  const [rows] = await pool.query(
    `SELECT u.permission_group_id, pg.name AS group_name, pg.is_system
     FROM users u
     LEFT JOIN permission_groups pg ON pg.id = u.permission_group_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.permission_group_id) {
    return {
      permissionGroupId: null,
      groupName: null,
      isAdmin: false,
      views: [],
    };
  }

  if (row.is_system) {
    return {
      permissionGroupId: Number(row.permission_group_id),
      groupName: row.group_name,
      isAdmin: true,
      views: [...ALL_VIEW_KEYS],
    };
  }

  const [viewRows] = await pool.query(
    'SELECT view_key FROM permission_group_views WHERE group_id = ? ORDER BY view_key',
    [row.permission_group_id],
  );

  return {
    permissionGroupId: Number(row.permission_group_id),
    groupName: row.group_name,
    isAdmin: false,
    views: viewRows.map((v) => v.view_key),
  };
}

export async function listPermissionGroups(pool) {
  const [rows] = await pool.query(
    `SELECT pg.id, pg.name, pg.description, pg.is_system, pg.created_at,
            COUNT(u.id) AS user_count
     FROM permission_groups pg
     LEFT JOIN users u ON u.permission_group_id = pg.id
     GROUP BY pg.id, pg.name, pg.description, pg.is_system, pg.created_at
     ORDER BY pg.is_system DESC, pg.name, pg.id`,
  );
  const viewsMap = await fetchGroupViews(
    pool,
    rows.map((row) => Number(row.id)),
  );
  return rows.map((row) => rowToGroup(row, viewsMap.get(Number(row.id)) || []));
}

export async function findPermissionGroupById(pool, id) {
  const [rows] = await pool.query(
    `SELECT pg.id, pg.name, pg.description, pg.is_system, pg.created_at,
            COUNT(u.id) AS user_count
     FROM permission_groups pg
     LEFT JOIN users u ON u.permission_group_id = pg.id
     WHERE pg.id = ?
     GROUP BY pg.id, pg.name, pg.description, pg.is_system, pg.created_at
     LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  const viewsMap = await fetchGroupViews(pool, [id]);
  return rowToGroup(rows[0], viewsMap.get(Number(id)) || []);
}

function normalizeGroupInput(raw, { forInsert = false } = {}) {
  const name = String(raw.name ?? '').trim();
  if (!name) {
    throw Object.assign(new Error('Nome do grupo é obrigatório'), { status: 400 });
  }
  const description = String(raw.description ?? '').trim();
  const views = normalizeViews(raw.views);
  if (forInsert && !views.length) {
    throw Object.assign(new Error('Selecione ao menos uma tela'), { status: 400 });
  }
  return { name, description: description || null, views };
}

export async function createPermissionGroup(pool, raw) {
  const data = normalizeGroupInput(raw, { forInsert: true });
  const [result] = await pool.query(
    'INSERT INTO permission_groups (name, description, is_system) VALUES (?, ?, 0)',
    [data.name, data.description],
  );
  const groupId = result.insertId;
  for (const viewKey of data.views) {
    await pool.query(
      'INSERT INTO permission_group_views (group_id, view_key) VALUES (?, ?)',
      [groupId, viewKey],
    );
  }
  return findPermissionGroupById(pool, groupId);
}

export async function updatePermissionGroup(pool, id, raw) {
  const existing = await findPermissionGroupById(pool, id);
  if (!existing) return null;

  const data = normalizeGroupInput(raw, { forInsert: !existing.isSystem });
  if (existing.isSystem) {
    await pool.query('UPDATE permission_groups SET description = ? WHERE id = ?', [
      data.description,
      id,
    ]);
    return findPermissionGroupById(pool, id);
  }

  await pool.query('UPDATE permission_groups SET name = ?, description = ? WHERE id = ?', [
    data.name,
    data.description,
    id,
  ]);
  await pool.query('DELETE FROM permission_group_views WHERE group_id = ?', [id]);
  for (const viewKey of data.views) {
    await pool.query(
      'INSERT INTO permission_group_views (group_id, view_key) VALUES (?, ?)',
      [id, viewKey],
    );
  }
  return findPermissionGroupById(pool, id);
}

export async function deletePermissionGroup(pool, id) {
  const existing = await findPermissionGroupById(pool, id);
  if (!existing) return false;
  if (existing.isSystem) {
    throw Object.assign(new Error('O grupo Administrador não pode ser excluído'), { status: 400 });
  }
  if (existing.userCount > 0) {
    throw Object.assign(
      new Error('Existem usuários neste grupo. Reatribua-os antes de excluir.'),
      { status: 409 },
    );
  }
  const [result] = await pool.query('DELETE FROM permission_groups WHERE id = ? AND is_system = 0', [
    id,
  ]);
  return result.affectedRows > 0;
}

export async function getDefaultPermissionGroupId(pool) {
  const [rows] = await pool.query(
    'SELECT id FROM permission_groups WHERE is_system = 1 ORDER BY id LIMIT 1',
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

function resolveApiPermission(path, method) {
  const p = path;
  const m = method.toUpperCase();

  if (p === '/api/auth/login' && m === 'POST') return { type: 'open' };
  if (p === '/api/auth/logout') return { type: 'open' };
  if (p.startsWith('/api/auth/otp/')) return { type: 'open' };
  if (p === '/api/auth/password/reset' && m === 'POST') return { type: 'open' };
  if (p.startsWith('/api/auth/')) return { type: 'shared' };
  if (p === '/api/health') return { type: 'open' };
  if (p.startsWith('/api/webhooks/')) return { type: 'open' };
  if (/^\/api\/whatsapp\/media\/\d+/.test(p)) return { type: 'open' };
  if (/^\/api\/whatsapp\/avatar\/\d+/.test(p)) return { type: 'open' };

  if (p === '/api/permission-groups/catalog') {
    return { type: 'anyOf', views: ['usuarios', 'permissoes'] };
  }
  if (p === '/api/permission-groups' && m === 'GET') {
    return { type: 'anyOf', views: ['usuarios', 'permissoes'] };
  }
  if (p.startsWith('/api/permission-groups')) return { type: 'view', view: 'permissoes' };
  if (p.startsWith('/api/users')) return { type: 'view', view: 'usuarios' };

  if (p.startsWith('/api/eventos')) {
    if (m === 'GET') return { type: 'shared' };
    return { type: 'view', view: 'eventos' };
  }
  if (p.startsWith('/api/grupos') || p.startsWith('/api/espacos-disponiveis')) {
    return { type: 'view', view: 'espacos' };
  }
  if (p.startsWith('/api/tipos-comercio')) return { type: 'shared' };
  if (p.startsWith('/api/funil-etapas')) return { type: 'anyOf', views: ['espacos', 'arrecadacao'] };
  if (p.startsWith('/api/funil-escopos')) return { type: 'shared' };

  if (p.startsWith('/api/arrecadacao')) {
    return { type: 'anyOf', views: ['arrecadacao', 'artistico', 'espacos', 'tarefas'] };
  }
  if (p.startsWith('/api/tarefas-contato')) return { type: 'view', view: 'tarefas' };
  if (p.startsWith('/api/marketing')) return { type: 'view', view: 'marketing' };
  if (p.startsWith('/api/producao/cronologia')) return { type: 'view', view: 'cronologia' };
  if (p.startsWith('/api/producao/premiacoes')) return { type: 'view', view: 'premiacoes' };
  if (p === '/api/financeiro/painel') {
    return { type: 'anyOf', views: ['financeiro-gestao', 'financeiro-contas-pagar'] };
  }
  if (
    p.startsWith('/api/financeiro/contas-pagar') ||
    p.startsWith('/api/financeiro/categorias') ||
    p.startsWith('/api/financeiro/plano-contas')
  ) {
    return { type: 'view', view: 'financeiro-contas-pagar' };
  }
  if (p.startsWith('/api/financeiro/')) return { type: 'view', view: 'financeiro-gestao' };

  if (p.startsWith('/api/whatsapp/connect') || p.startsWith('/api/whatsapp/disconnect')) {
    return { type: 'admin' };
  }
  if (p.startsWith('/api/whatsapp/')) {
    return { type: 'anyOf', views: WHATSAPP_VIEWS };
  }
  if (p.startsWith('/api/participantes')) return { type: 'shared' };
  if (p.startsWith('/api/link-preview')) return { type: 'shared' };

  return { type: 'shared' };
}

function userCanAccessRule(user, rule) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const views = user.permissions || [];
  if (!views.length) return false;

  if (rule.type === 'admin') return Boolean(user.isAdmin);
  if (rule.type === 'open' || rule.type === 'shared') return views.length > 0;
  if (rule.type === 'view') return views.includes(rule.view);
  if (rule.type === 'anyOf') return rule.views.some((view) => views.includes(view));
  return true;
}

export function isPublicApiRoute(req) {
  if (req.path === '/api/health') return true;
  if (req.path === '/api/auth/login' && req.method === 'POST') return true;
  if (req.path === '/api/auth/logout') return true;
  if (req.path.startsWith('/api/auth/otp/')) return true;
  if (req.path === '/api/auth/password/reset' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/webhooks/')) return true;
  if (/^\/api\/whatsapp\/media\/\d+/.test(req.path)) return true;
  if (/^\/api\/whatsapp\/avatar\/\d+/.test(req.path)) return true;
  return false;
}

export function loadUserPermissions(pool) {
  return async (req, res, next) => {
    if (!req.user?.id) return next();
    try {
      const access = await getUserAccess(pool, req.user.id);
      req.user.permissionGroupId = access.permissionGroupId;
      req.user.permissionGroupName = access.groupName;
      req.user.isAdmin = access.isAdmin;
      req.user.permissions = access.views;
      next();
    } catch (err) {
      console.error('loadUserPermissions', err);
      res.status(500).json({ error: 'Falha ao carregar permissões' });
    }
  };
}

export function enforceApiPermission(req, res, next) {
  if (!req.user) return next();
  const rule = resolveApiPermission(req.path, req.method);
  if (rule.type === 'open') return next();
  if (userCanAccessRule(req.user, rule)) return next();
  return res.status(403).json({ error: 'Sem permissão para esta área' });
}

export function buildPublicAccess(user, access) {
  return {
    permissionGroupId: access.permissionGroupId,
    permissionGroupName: access.groupName,
    isAdmin: access.isAdmin,
    permissions: access.views,
  };
}
