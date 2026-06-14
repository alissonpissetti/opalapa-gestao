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
