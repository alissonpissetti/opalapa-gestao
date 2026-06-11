import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'opalapa_session';
const SESSION_DAYS = 7;

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn('SESSION_SECRET não definida — usando valor temporário (não use em produção)');
    return 'opalapa-dev-secret-change-me';
  }
  return secret;
}

export function normalizeLogin(login) {
  const trimmed = String(login || '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return { type: 'email', value: trimmed.toLowerCase() };
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits ? { type: 'phone', value: digits } : null;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
    getSessionSecret(),
    { expiresIn: `${SESSION_DAYS}d` },
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSessionSecret());
  } catch {
    return null;
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    phone: user.phone || null,
  };
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Sessão expirada' });
  }

  req.user = {
    id: payload.sub,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
  };
  next();
}
