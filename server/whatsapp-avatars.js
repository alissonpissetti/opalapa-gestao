import { fetchProfilePictureUrl } from './evolution.js';
import { signWhatsappAvatarToken } from './auth.js';
import { toWhatsAppNumber } from './whatsapp-phone.js';

const AVATAR_CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;

export function whatsappAvatarApiUrl(participanteId, eventoId, token) {
  const base = `/api/whatsapp/avatar/${participanteId}`;
  if (!token) return base;
  return `${base}?t=${encodeURIComponent(token)}`;
}

export function attachAvatarUrlsToThreads(threads, eventoId) {
  if (!Array.isArray(threads) || !eventoId) return threads;
  return threads.map((thread) => {
    if (!thread?.participanteId) return thread;
    const token = signWhatsappAvatarToken(thread.participanteId, eventoId);
    return {
      ...thread,
      avatarUrl: whatsappAvatarApiUrl(thread.participanteId, eventoId, token),
    };
  });
}

function cacheKeyForPhone(phone) {
  return toWhatsAppNumber(phone) || String(phone || '').replace(/\D/g, '');
}

async function fetchAvatarEntry(phone) {
  const key = cacheKeyForPhone(phone);
  if (!key) return null;

  const cached = AVATAR_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.missing ? null : cached;
  }

  let profilePictureUrl = null;
  try {
    profilePictureUrl = await fetchProfilePictureUrl(key);
  } catch (err) {
    console.warn(`fetchProfilePictureUrl ${key}:`, err.message);
  }

  if (!profilePictureUrl) {
    AVATAR_CACHE.set(key, { missing: true, expiresAt: Date.now() + MISS_TTL_MS });
    return null;
  }

  try {
    const remote = await fetch(profilePictureUrl);
    if (!remote.ok) {
      AVATAR_CACHE.set(key, { missing: true, expiresAt: Date.now() + MISS_TTL_MS });
      return null;
    }
    const buffer = Buffer.from(await remote.arrayBuffer());
    if (!buffer.length) {
      AVATAR_CACHE.set(key, { missing: true, expiresAt: Date.now() + MISS_TTL_MS });
      return null;
    }
    const entry = {
      buffer,
      contentType: remote.headers.get('content-type') || 'image/jpeg',
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    AVATAR_CACHE.set(key, entry);
    return entry;
  } catch (err) {
    console.warn(`fetch avatar image ${key}:`, err.message);
    AVATAR_CACHE.set(key, { missing: true, expiresAt: Date.now() + MISS_TTL_MS });
    return null;
  }
}

export async function getParticipantePhoneForEvento(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT p.contato_telefone
     FROM participantes p
     JOIN arrecadacao a ON a.participante_id = p.id
     WHERE a.evento_id = ? AND p.id = ? AND TRIM(p.contato_telefone) <> ''
     LIMIT 1`,
    [eventoId, participanteId],
  );
  return rows[0]?.contato_telefone || '';
}

export async function streamWhatsappAvatar(pool, eventoId, participanteId, res) {
  const phone = await getParticipantePhoneForEvento(pool, eventoId, participanteId);
  if (!phone) {
    throw Object.assign(new Error('Contato não encontrado'), { status: 404 });
  }

  const entry = await fetchAvatarEntry(phone);
  if (!entry?.buffer?.length) {
    throw Object.assign(new Error('Avatar não disponível'), { status: 404 });
  }

  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(entry.buffer);
}
