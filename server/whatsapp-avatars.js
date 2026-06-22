import { fetchProfilePictureUrl } from './evolution.js';
import { signWhatsappAvatarToken } from './auth.js';
import { toWhatsAppNumber } from './whatsapp-phone.js';
import {
  buildAvatarStoragePath,
  contentTypeForAvatarPath,
  deleteAvatarFile,
  extForAvatarContentType,
  readAvatarFile,
  saveAvatarFile,
} from './local-media.js';

const AVATAR_CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const AVATAR_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function whatsappAvatarApiUrl(participanteId, eventoId, token) {
  const base = `/api/whatsapp/avatar/${participanteId}`;
  if (!token) return base;
  return `${base}?t=${encodeURIComponent(token)}`;
}

export function participanteAvatarApiUrl(participanteId, eventoId) {
  const token = signWhatsappAvatarToken(participanteId, eventoId);
  return whatsappAvatarApiUrl(participanteId, eventoId, token);
}

export function attachAvatarUrlToParticipante(participante, eventoId) {
  if (!participante?.id || !eventoId) return participante;
  if (!String(participante.contatoTelefone || '').trim()) return participante;
  return {
    ...participante,
    avatarUrl: participanteAvatarApiUrl(participante.id, eventoId),
  };
}

export function attachAvatarUrlsToParticipantes(participantes, eventoId) {
  if (!Array.isArray(participantes) || !eventoId) return participantes;
  return participantes.map((p) => attachAvatarUrlToParticipante(p, eventoId));
}

export function attachAvatarUrlsToThreads(threads, eventoId) {
  if (!Array.isArray(threads) || !eventoId) return threads;
  return threads.map((thread) => {
    if (!thread?.participanteId) return thread;
    return {
      ...thread,
      avatarUrl: participanteAvatarApiUrl(thread.participanteId, eventoId),
    };
  });
}

function cacheKeyForPhone(phone) {
  return toWhatsAppNumber(phone) || String(phone || '').replace(/\D/g, '');
}

async function fetchAvatarEntryFromWhatsapp(phone) {
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

export async function getParticipantePhone(pool, participanteId) {
  const [rows] = await pool.query(
    `SELECT contato_telefone FROM participantes WHERE id = ? AND TRIM(contato_telefone) <> '' LIMIT 1`,
    [participanteId],
  );
  return rows[0]?.contato_telefone || '';
}

export async function getParticipantePhoneForEvento(pool, eventoId, participanteId) {
  const phone = await getParticipantePhone(pool, participanteId);
  if (phone) return phone;

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

async function getParticipanteAvatarMeta(pool, participanteId) {
  const [rows] = await pool.query(
    `SELECT whatsapp_avatar_path, whatsapp_avatar_synced_at
     FROM participantes WHERE id = ? LIMIT 1`,
    [participanteId],
  );
  return rows[0] || null;
}

async function getStoredAvatarEntry(pool, participanteId) {
  const meta = await getParticipanteAvatarMeta(pool, participanteId);
  if (!meta?.whatsapp_avatar_path) return null;
  const buffer = await readAvatarFile(meta.whatsapp_avatar_path);
  if (!buffer?.length) return null;
  return {
    buffer,
    contentType: contentTypeForAvatarPath(meta.whatsapp_avatar_path),
    storagePath: meta.whatsapp_avatar_path,
  };
}

async function saveParticipanteAvatar(pool, participanteId, buffer, contentType) {
  const meta = await getParticipanteAvatarMeta(pool, participanteId);
  const oldPath = meta?.whatsapp_avatar_path || null;
  const ext = extForAvatarContentType(contentType);
  const storagePath = buildAvatarStoragePath(participanteId, ext);
  if (oldPath && oldPath !== storagePath) {
    await deleteAvatarFile(oldPath);
  }
  await saveAvatarFile(storagePath, buffer);
  await pool.query(
    `UPDATE participantes
     SET whatsapp_avatar_path = ?, whatsapp_avatar_synced_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [storagePath, participanteId],
  );
  return {
    buffer,
    contentType: contentTypeForAvatarPath(storagePath),
    storagePath,
  };
}

function avatarNeedsRefresh(meta, { force = false } = {}) {
  if (force) return true;
  if (!meta?.whatsapp_avatar_path) return true;
  if (!meta?.whatsapp_avatar_synced_at) return true;
  const syncedAt = new Date(meta.whatsapp_avatar_synced_at).getTime();
  return syncedAt < Date.now() - AVATAR_REFRESH_MS;
}

export async function syncParticipanteAvatar(pool, participanteId, phone = null, { force = false } = {}) {
  const id = Number(participanteId);
  if (!Number.isInteger(id) || id < 1) return null;

  const tel = phone || (await getParticipantePhone(pool, id));
  if (!tel) return null;

  const meta = await getParticipanteAvatarMeta(pool, id);
  if (!avatarNeedsRefresh(meta, { force })) {
    return getStoredAvatarEntry(pool, id);
  }

  const remote = await fetchAvatarEntryFromWhatsapp(tel);
  if (!remote?.buffer?.length) {
    await pool.query(
      `UPDATE participantes SET whatsapp_avatar_synced_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [id],
    );
    return getStoredAvatarEntry(pool, id);
  }

  return saveParticipanteAvatar(pool, id, remote.buffer, remote.contentType);
}

export async function syncStaleParticipantAvatars(pool, eventoId, { limit = 8 } = {}) {
  if (!eventoId) return;
  const [rows] = await pool.query(
    `SELECT p.id, p.contato_telefone
     FROM participantes p
     JOIN arrecadacao a ON a.participante_id = p.id
     WHERE a.evento_id = ? AND TRIM(p.contato_telefone) <> ''
       AND (
         p.whatsapp_avatar_path IS NULL
         OR p.whatsapp_avatar_synced_at IS NULL
         OR p.whatsapp_avatar_synced_at < DATE_SUB(NOW(3), INTERVAL 7 DAY)
       )
     GROUP BY p.id, p.contato_telefone
     ORDER BY p.whatsapp_avatar_synced_at IS NULL DESC, p.whatsapp_avatar_synced_at ASC
     LIMIT ?`,
    [eventoId, limit],
  );

  for (const row of rows) {
    try {
      await syncParticipanteAvatar(pool, row.id, row.contato_telefone, { force: false });
    } catch (err) {
      console.warn(`sync avatar participante ${row.id}:`, err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

export async function streamWhatsappAvatar(pool, eventoId, participanteId, res) {
  const stored = await getStoredAvatarEntry(pool, participanteId);
  if (stored?.buffer?.length) {
    res.setHeader('Content-Type', stored.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(stored.buffer);
    return;
  }

  const phone = await getParticipantePhoneForEvento(pool, eventoId, participanteId);
  if (!phone) {
    throw Object.assign(new Error('Contato não encontrado'), { status: 404 });
  }

  const synced = await syncParticipanteAvatar(pool, participanteId, phone, { force: true });
  if (!synced?.buffer?.length) {
    throw Object.assign(new Error('Avatar não disponível'), { status: 404 });
  }

  res.setHeader('Content-Type', synced.contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(synced.buffer);
}
