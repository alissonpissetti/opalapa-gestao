import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { normalizeLogin } from './auth.js';
import { findUserByLogin } from './users.js';
import { sendSms, shouldEchoDevCode } from './sms.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PURPOSES = ['login', 'password_reset'];

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return bcrypt.hash(String(code), 8);
}

async function verifyCodeHash(code, hash) {
  return bcrypt.compare(String(code), hash);
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '****';
  return `****${d.slice(-4)}`;
}

async function resolveUserForOtp(pool, loginRaw, { phoneOnly = false } = {}) {
  const login = normalizeLogin(loginRaw);
  if (!login) {
    throw Object.assign(new Error('Informe e-mail ou celular válido'), { status: 400 });
  }
  if (phoneOnly && login.type !== 'phone') {
    throw Object.assign(new Error('Informe o celular cadastrado'), { status: 400 });
  }

  const user = await findUserByLogin(pool, login);
  if (!user) {
    throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });
  }
  if (!user.phone) {
    throw Object.assign(
      new Error('Este usuário não possui celular cadastrado para receber o código'),
      { status: 400 },
    );
  }
  return user;
}

export async function migrateAuthOtp(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_otp_codes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      phone VARCHAR(20) NOT NULL,
      purpose ENUM('login', 'password_reset') NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_auth_otp_user (user_id, purpose, used_at, expires_at),
      CONSTRAINT fk_auth_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function sendAuthOtp(pool, { login, purpose }) {
  const purposeNorm = String(purpose || '').toLowerCase();
  if (!PURPOSES.includes(purposeNorm)) {
    throw Object.assign(new Error('Finalidade do código inválida'), { status: 400 });
  }

  const phoneOnly = purposeNorm === 'login';
  const user = await resolveUserForOtp(pool, login, { phoneOnly });

  const [recentRows] = await pool.query(
    `SELECT created_at FROM auth_otp_codes
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [user.id, purposeNorm],
  );
  if (recentRows[0]?.created_at) {
    const elapsed = Date.now() - new Date(recentRows[0].created_at).getTime();
    if (elapsed < OTP_RESEND_MS) {
      const waitSec = Math.ceil((OTP_RESEND_MS - elapsed) / 1000);
      throw Object.assign(new Error(`Aguarde ${waitSec}s para solicitar um novo código`), {
        status: 429,
      });
    }
  }

  await pool.query(
    'UPDATE auth_otp_codes SET used_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    [user.id, purposeNorm],
  );

  const code = generateCode();
  const codeHash = await hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `INSERT INTO auth_otp_codes (user_id, phone, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, user.phone, purposeNorm, codeHash, expiresAt],
  );

  const message =
    purposeNorm === 'password_reset'
      ? `Opalapa Gestão: código ${code} para redefinir sua senha. Válido por 10 minutos.`
      : `Opalapa Gestão: seu código de acesso é ${code}. Válido por 10 minutos.`;

  await sendSms(user.phone, message);

  const out = {
    ok: true,
    phoneMask: maskPhone(user.phone),
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
  };
  if (shouldEchoDevCode()) {
    out.devCode = code;
  }
  return out;
}

async function verifyAuthOtp(pool, { login, purpose, code }) {
  const purposeNorm = String(purpose || '').toLowerCase();
  if (!PURPOSES.includes(purposeNorm)) {
    throw Object.assign(new Error('Finalidade do código inválida'), { status: 400 });
  }
  const codeStr = String(code || '').trim();
  if (!/^\d{6}$/.test(codeStr)) {
    throw Object.assign(new Error('Informe o código de 6 dígitos'), { status: 400 });
  }

  const phoneOnly = purposeNorm === 'login';
  const user = await resolveUserForOtp(pool, login, { phoneOnly });

  const [rows] = await pool.query(
    `SELECT id, code_hash, attempts, expires_at
     FROM auth_otp_codes
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [user.id, purposeNorm],
  );
  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error('Código expirado ou não solicitado'), { status: 400 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error('Código expirado'), { status: 400 });
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    throw Object.assign(new Error('Muitas tentativas. Solicite um novo código.'), { status: 429 });
  }

  const valid = await verifyCodeHash(codeStr, row.code_hash);
  if (!valid) {
    await pool.query('UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw Object.assign(new Error('Código incorreto'), { status: 401 });
  }

  await pool.query('UPDATE auth_otp_codes SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    row.id,
  ]);
  return user;
}

export async function verifySmsLogin(pool, { login, code }) {
  return verifyAuthOtp(pool, { login, purpose: 'login', code });
}

export async function verifyPasswordResetOtp(pool, { login, code }) {
  return verifyAuthOtp(pool, { login, purpose: 'password_reset', code });
}
