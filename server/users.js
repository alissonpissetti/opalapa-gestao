function rowToUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    password_hash: row.password_hash,
    permissionGroupId:
      row.permission_group_id != null ? Number(row.permission_group_id) : null,
    permissionGroupName: row.permission_group_name || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export function publicUserRow(user, access = null) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    phone: user.phone || null,
    permissionGroupId: user.permissionGroupId ?? access?.permissionGroupId ?? null,
    permissionGroupName: user.permissionGroupName ?? access?.groupName ?? null,
    isAdmin: access?.isAdmin ?? false,
    permissions: access?.views ?? [],
    createdAt: user.createdAt || null,
  };
}

export function normalizeUserInput(
  { name, email, phone, password, permissionGroupId },
  { requirePassword = false } = {},
) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw Object.assign(new Error('Nome é obrigatório'), { status: 400 });
  }

  const normalizedEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : null;
  const normalizedPhone = phone && String(phone).trim() ? String(phone).replace(/\D/g, '') : null;

  if (!normalizedEmail && !normalizedPhone) {
    throw Object.assign(new Error('Informe e-mail ou celular'), { status: 400 });
  }

  const normalizedPassword = password != null ? String(password) : '';
  if (requirePassword && !normalizedPassword.trim()) {
    throw Object.assign(new Error('Senha é obrigatória'), { status: 400 });
  }

  return {
    name: normalizedName,
    email: normalizedEmail,
    phone: normalizedPhone,
    password: normalizedPassword,
    permissionGroupId:
      permissionGroupId != null && String(permissionGroupId).trim() !== ''
        ? Number(permissionGroupId)
        : null,
  };
}

export async function migrateUsers(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(20) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone),
      CONSTRAINT chk_users_login CHECK (email IS NOT NULL OR phone IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listUsers(pool) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.created_at, u.permission_group_id, pg.name AS permission_group_name
     FROM users u
     LEFT JOIN permission_groups pg ON pg.id = u.permission_group_id
     ORDER BY u.name, u.id`,
  );
  return rows.map((row) => publicUserRow(rowToUser(row)));
}

export async function findUserByLogin(pool, loginInfo) {
  const [rows] = await pool.query(
    loginInfo.type === 'email'
      ? 'SELECT id, name, email, phone, password_hash, created_at FROM users WHERE email = ? LIMIT 1'
      : 'SELECT id, name, email, phone, password_hash, created_at FROM users WHERE phone = ? LIMIT 1',
    [loginInfo.value],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function findUserById(pool, id) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.created_at, u.permission_group_id, pg.name AS permission_group_name
     FROM users u
     LEFT JOIN permission_groups pg ON pg.id = u.permission_group_id
     WHERE u.id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function createUser(pool, { name, email, phone, passwordHash, permissionGroupId }) {
  const [result] = await pool.query(
    'INSERT INTO users (name, email, phone, password_hash, permission_group_id) VALUES (?, ?, ?, ?, ?)',
    [name, email || null, phone || null, passwordHash, permissionGroupId || null],
  );
  return findUserById(pool, result.insertId);
}

export async function updateUser(
  pool,
  id,
  { name, email, phone, passwordHash, permissionGroupId },
) {
  if (passwordHash) {
    await pool.query(
      'UPDATE users SET name = ?, email = ?, phone = ?, password_hash = ?, permission_group_id = ? WHERE id = ?',
      [name, email || null, phone || null, passwordHash, permissionGroupId || null, id],
    );
  } else {
    await pool.query(
      'UPDATE users SET name = ?, email = ?, phone = ?, permission_group_id = ? WHERE id = ?',
      [name, email || null, phone || null, permissionGroupId || null, id],
    );
  }
  return findUserById(pool, id);
}

export async function deleteUser(pool, id) {
  const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countUsers(pool) {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}
