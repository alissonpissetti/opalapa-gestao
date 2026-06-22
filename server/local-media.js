import fs from 'fs/promises';
import path from 'path';

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_DIR || path.join(process.cwd(), 'data', 'whatsapp-media');

export function isLocalMediaPath(storagePath) {
  return String(storagePath || '').startsWith('file:');
}

export function buildLocalMediaKey(arrecadacaoId, evolutionMessageId, ext) {
  const safeId = String(evolutionMessageId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `file:${arrecadacaoId}/${safeId}${ext}`;
}

function resolveLocalFilePath(storagePath) {
  const rel = String(storagePath || '').replace(/^file:/, '');
  const full = path.join(MEDIA_ROOT, rel);
  if (!full.startsWith(MEDIA_ROOT)) {
    throw Object.assign(new Error('Caminho de mídia inválido'), { status: 400 });
  }
  return full;
}

export async function saveLocalMedia(storagePath, buffer) {
  const full = resolveLocalFilePath(storagePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return storagePath;
}

export async function readLocalMedia(storagePath) {
  if (!isLocalMediaPath(storagePath)) return null;
  const full = resolveLocalFilePath(storagePath);
  try {
    return await fs.readFile(full);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function localMediaExists(storagePath) {
  if (!isLocalMediaPath(storagePath)) return false;
  try {
    await fs.access(resolveLocalFilePath(storagePath));
    return true;
  } catch {
    return false;
  }
}

const AVATAR_ROOT = process.env.WHATSAPP_AVATAR_DIR || path.join(process.cwd(), 'data', 'whatsapp-avatars');

export function buildAvatarStoragePath(participanteId, ext = '.jpg') {
  return `file:avatars/${participanteId}${ext}`;
}

function resolveAvatarFilePath(storagePath) {
  const rel = String(storagePath || '').replace(/^file:/, '');
  const full = path.join(AVATAR_ROOT, rel);
  if (!full.startsWith(AVATAR_ROOT)) {
    throw Object.assign(new Error('Caminho de avatar inválido'), { status: 400 });
  }
  return full;
}

export async function readAvatarFile(storagePath) {
  if (!isLocalMediaPath(storagePath)) return null;
  try {
    return await fs.readFile(resolveAvatarFilePath(storagePath));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveAvatarFile(storagePath, buffer) {
  const full = resolveAvatarFilePath(storagePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return storagePath;
}

export async function deleteAvatarFile(storagePath) {
  if (!isLocalMediaPath(storagePath)) return;
  try {
    await fs.unlink(resolveAvatarFilePath(storagePath));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function contentTypeForAvatarPath(storagePath) {
  const ext = path.extname(String(storagePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export function extForAvatarContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}
