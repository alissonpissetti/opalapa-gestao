import {
  getNextcloudConfig,
  uploadToNextcloud,
  downloadFromNextcloud,
} from './nextcloud.js';
import { getBase64FromMediaMessage, findChatMessageByKey, findChatMessageById } from './evolution.js';
import { remoteJidVariantsFromPhone } from './whatsapp-phone.js';
import {
  buildLocalMediaKey,
  isLocalMediaPath,
  localMediaExists,
  readLocalMedia,
  saveLocalMedia,
} from './local-media.js';

const MEDIA_TIPOS = new Set(['image', 'audio', 'video', 'document', 'sticker']);
const BACKFILL_MAX_PER_SYNC = 8;
const BACKFILL_DELAY_MS = 400;
const MEDIA_WORKER_BATCH = 6;
const MEDIA_WORKER_INTERVAL_MS = 12000;

export function isWhatsappMediaTipo(tipo) {
  return MEDIA_TIPOS.has(String(tipo || ''));
}

import { signWhatsappMediaToken } from './auth.js';

export function whatsappMediaApiUrl(mensagemId, token) {
  const base = `/api/whatsapp/media/${mensagemId}`;
  if (!token) return base;
  return `${base}?t=${encodeURIComponent(token)}`;
}

export function whatsappMediaPreviewApiUrl(mensagemId, token) {
  const base = `/api/whatsapp/media/${mensagemId}?preview=1`;
  if (!token) return base;
  return `${base}&t=${encodeURIComponent(token)}`;
}

export function midiaPreviewUrlForMensagemRow(row) {
  if (!row?.midia_preview_path) return null;
  return whatsappMediaPreviewApiUrl(row.id);
}

export function attachMediaTokenToMensagem(mensagem) {
  if (!mensagem?.id) return mensagem;
  const token = signWhatsappMediaToken(mensagem.id);
  const out = { ...mensagem };

  if (
    mensagem.midiaUrl &&
    String(mensagem.midiaUrl).startsWith('/api/whatsapp/media/') &&
    !String(mensagem.midiaUrl).includes('?t=')
  ) {
    out.midiaUrl = whatsappMediaApiUrl(mensagem.id, token);
  }

  if (
    mensagem.midiaPreviewUrl &&
    String(mensagem.midiaPreviewUrl).startsWith('/api/whatsapp/media/') &&
    !String(mensagem.midiaPreviewUrl).includes('?t=')
  ) {
    out.midiaPreviewUrl = whatsappMediaPreviewApiUrl(mensagem.id, token);
  }

  return out;
}

export function attachMediaTokensToMensagens(mensagens) {
  if (!Array.isArray(mensagens)) return mensagens;
  return mensagens.map((m) => attachMediaTokenToMensagem(m));
}

export function midiaUrlForMensagemRow(row) {
  if (isWhatsappMediaTipo(row?.tipo)) {
    return whatsappMediaApiUrl(row.id);
  }
  return row?.midia_storage_path ? whatsappMediaApiUrl(row.id) : row?.midia_url || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneMediaBuffer(buffer) {
  if (!buffer?.length) return Buffer.alloc(0);
  return Buffer.from(buffer);
}

function isWhatsappCdnUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host.includes('whatsapp.net') || host.includes('whatsapp.com');
  } catch {
    return false;
  }
}

function isValidMediaBuffer(buffer, mimetype, tipo) {
  if (!buffer?.length || buffer.length < 4) return false;

  const mime = String(mimetype || '').toLowerCase();
  const t = String(tipo || '').toLowerCase();
  const head4 = buffer.slice(0, 4).toString('ascii');
  const head3 = buffer.slice(0, 3).toString('ascii');

  if (head4 === 'OggS') return true;
  if (head3 === 'ID3') return true;
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (head3 === 'GIF') return true;
  if (head4 === 'RIFF' && buffer.length >= 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer.length >= 8 && buffer.slice(4, 8).toString('ascii') === 'ftyp') return true;
  if (head4 === '%PDF') return true;

  if (t === 'audio' || mime.includes('audio')) return false;
  if (t === 'image' || t === 'sticker' || mime.includes('image')) return false;
  if (t === 'video' || mime.includes('video')) {
    return buffer.length >= 8 && buffer.slice(4, 8).toString('ascii') === 'ftyp';
  }

  return buffer.length >= 64;
}

function buildNextcloudRelPath(nextcloud, arrecadacaoId, evolutionMessageId, tipo, mimetype, fileName) {
  const ext = extensionFromFileName(fileName) || extFromMime(mimetype, tipo);
  const safeId = String(evolutionMessageId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${nextcloud.basePath}/${arrecadacaoId}/${safeId}${ext}`;
}

function mediaNodeFromRecord(record, tipo) {
  const message = record?.message && typeof record.message === 'object' ? record.message : {};
  const key = tipo || '';
  if (key === 'image') return message.imageMessage;
  if (key === 'video') return message.videoMessage;
  if (key === 'audio') return message.audioMessage;
  if (key === 'document') return message.documentMessage;
  if (key === 'sticker') return message.stickerMessage;
  return (
    message.imageMessage ||
    message.videoMessage ||
    message.audioMessage ||
    message.documentMessage ||
    message.stickerMessage ||
    null
  );
}

function hasUsableMediaPayload(record) {
  const message = record?.message;
  if (!message || typeof message !== 'object') return false;
  const nodes = [
    message.imageMessage,
    message.videoMessage,
    message.audioMessage,
    message.documentMessage,
    message.stickerMessage,
  ];
  return nodes.some(
    (node) =>
      node &&
      (node.url || node.base64 || node.mediaKey || node.directPath || node.mimetype),
  );
}

async function tryDirectMediaUrl(rawRecord, tipo) {
  const node = mediaNodeFromRecord(rawRecord, tipo);
  const url = node?.url;
  if (!url || !String(url).startsWith('http')) return null;
  // URLs do CDN do WhatsApp retornam bytes criptografados — só a Evolution descriptografa.
  if (isWhatsappCdnUrl(url) || node?.mediaKey) return null;

  try {
    const remote = await fetch(url, { redirect: 'follow' });
    if (!remote.ok) return null;
    const buffer = Buffer.from(await remote.arrayBuffer());
    if (!buffer.length) return null;
    const mimetype = node.mimetype || remote.headers.get('content-type') || null;
    if (!isValidMediaBuffer(buffer, mimetype, tipo)) return null;
    return {
      buffer,
      mimetype,
      fileName: node.fileName || node.title || null,
    };
  } catch {
    return null;
  }
}
function buildMinimalMediaRecord(row) {
  const message = {};
  const tipo = row.tipo;
  if (tipo === 'image') message.imageMessage = {};
  else if (tipo === 'video') message.videoMessage = {};
  else if (tipo === 'audio') message.audioMessage = {};
  else if (tipo === 'sticker') message.stickerMessage = {};
  else if (tipo === 'document') message.documentMessage = {};

  return {
    key: {
      id: String(row.evolution_message_id),
      remoteJid: String(row.remote_jid || ''),
      fromMe: row.direcao === 'out',
    },
    message,
  };
}

async function resolveEvolutionMediaRecords(pool, row) {
  const records = [];
  const seen = new Set();

  const push = (record) => {
    const id = record?.key?.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    records.push(record);
  };

  const jids = new Set([row.remote_jid].filter(Boolean));

  try {
    const byId = await findChatMessageById(row.evolution_message_id);
    if (byId) push(byId);
  } catch {
    // tenta por JID
  }

  try {
    const [phoneRows] = await pool.query(
      `SELECT p.contato_telefone
       FROM arrecadacao a
       JOIN participantes p ON p.id = a.participante_id
       WHERE a.id = ?
       LIMIT 1`,
      [row.arrecadacao_id],
    );
    const phone = phoneRows[0]?.contato_telefone;
    if (phone) {
      for (const jid of remoteJidVariantsFromPhone(phone)) {
        jids.add(jid);
      }
    }
  } catch {
    // segue com remote_jid salvo na mensagem
  }

  for (const jid of jids) {
    try {
      const found = await findChatMessageByKey(jid, row.evolution_message_id);
      if (found) push(found);
    } catch {
      // tenta próximo jid
    }
  }

  if (!records.length) {
    push(buildMinimalMediaRecord(row));
  }

  return records.filter(hasUsableMediaPayload);
}

function extractMediaBase64FromRecord(record, tipo) {
  const message =
    record?.message && typeof record.message === 'object'
      ? record.message
      : null;

  const direct = message?.base64 || record?.base64;
  if (direct) {
    return {
      buffer: Buffer.from(String(direct), 'base64'),
      mimetype:
        message?.mimetype ||
        record?.mimetype ||
        message?.imageMessage?.mimetype ||
        message?.videoMessage?.mimetype ||
        message?.audioMessage?.mimetype ||
        message?.documentMessage?.mimetype ||
        message?.stickerMessage?.mimetype ||
        null,
      fileName: message?.fileName || record?.fileName || null,
    };
  }

  const mediaKeys = ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage'];
  for (const key of mediaKeys) {
    const node = message?.[key];
    if (!node?.base64) continue;
    return {
      buffer: Buffer.from(String(node.base64), 'base64'),
      mimetype: node.mimetype || null,
      fileName: node.fileName || node.title || null,
    };
  }

  return null;
}

export async function storeMediaBuffer(
  pool,
  { mensagemId, arrecadacaoId, evolutionMessageId, tipo, mimetype, fileName, buffer, rawRecord },
) {
  const body = cloneMediaBuffer(buffer);
  if (!body.length) return null;

  const finalMimetype = mimetype || 'application/octet-stream';
  if (!isValidMediaBuffer(body, finalMimetype, tipo)) {
    throw Object.assign(new Error('Arquivo de mídia inválido (possivelmente criptografado)'), {
      status: 422,
    });
  }
  const ext = extensionFromFileName(fileName) || extFromMime(finalMimetype, tipo);
  const localKey = buildLocalMediaKey(arrecadacaoId, evolutionMessageId, ext);

  await saveLocalMedia(localKey, body);
  await pool.query(
    `UPDATE whatsapp_mensagens
     SET midia_storage_path = ?, midia_mimetype = ?, midia_mirror_erro = NULL
     WHERE id = ?`,
    [localKey, finalMimetype, mensagemId],
  );

  const nextcloud = getNextcloudConfig();
  if (nextcloud.enabled) {
    const ncPath = buildNextcloudRelPath(
      nextcloud,
      arrecadacaoId,
      evolutionMessageId,
      tipo,
      finalMimetype,
      fileName,
    );
    void uploadToNextcloud(ncPath, body, finalMimetype).catch((err) => {
      console.warn(`nextcloud mirror ${mensagemId}:`, err.message);
    });
  }

  if (tipo === 'document' && rawRecord) {
    await saveDocumentPreviewFromRecord(pool, {
      mensagemId,
      arrecadacaoId,
      evolutionMessageId,
      rawRecord,
    });
  }

  return { storagePath: localKey, mimetype: finalMimetype };
}

export async function persistMediaFromRecord(pool, params) {
  const extracted = params.rawRecord
    ? extractMediaBase64FromRecord(params.rawRecord, params.tipo)
    : null;
  if (extracted?.buffer?.length) {
    return storeMediaBuffer(pool, {
      ...params,
      buffer: extracted.buffer,
      mimetype: extracted.mimetype || params.mimetype,
      fileName: extracted.fileName,
    });
  }
  return mirrorWhatsappMedia(pool, { ...params, forceRetry: true });
}

export function schedulePersistMediaFromRecord(pool, params, onStored) {
  persistMediaFromRecord(pool, params)
    .then((result) => {
      if (result?.storagePath && onStored) onStored(result);
    })
    .catch((err) => {
      console.warn(`persistMediaFromRecord ${params.mensagemId}:`, err.message);
    });
}

async function readStoredMedia(row) {
  if (!row?.midia_storage_path) return null;

  if (isLocalMediaPath(row.midia_storage_path)) {
    const buffer = await readLocalMedia(row.midia_storage_path);
    if (buffer?.length) return buffer;
    return null;
  }

  if (getNextcloudConfig().enabled) {
    return downloadFromNextcloud(row.midia_storage_path);
  }

  return null;
}

function extFromMime(mimetype, tipo) {
  const mime = String(mimetype || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('pdf')) return '.pdf';
  const defaults = {
    image: '.jpg',
    audio: '.ogg',
    video: '.mp4',
    sticker: '.webp',
    document: '.bin',
  };
  return defaults[tipo] || '.bin';
}

function extensionFromFileName(fileName) {
  const match = String(fileName || '').match(/(\.[a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : '';
}

function thumbnailBufferFromValue(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value) && value.length) return value;
  if (value instanceof Uint8Array && value.length) return Buffer.from(value);
  if (typeof value === 'string' && value.length) {
    try {
      const buffer = Buffer.from(value, 'base64');
      return buffer.length ? buffer : null;
    } catch {
      return null;
    }
  }
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    const buffer = Buffer.from(value.data);
    return buffer.length ? buffer : null;
  }
  return null;
}

function documentNodeFromRecord(rawRecord) {
  return rawRecord?.message?.documentMessage || null;
}

function extractDocumentThumbnail(rawRecord) {
  return thumbnailBufferFromValue(documentNodeFromRecord(rawRecord)?.jpegThumbnail);
}

function extractDocumentMeta(rawRecord) {
  const node = documentNodeFromRecord(rawRecord);
  if (!node) return { fileSize: null, pageCount: null };
  const fileSize = Number(node.fileLength);
  const pageCount = Number(node.pageCount);
  return {
    fileSize: Number.isFinite(fileSize) && fileSize > 0 ? fileSize : null,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : null,
  };
}

async function saveDocumentPreviewFromRecord(pool, { mensagemId, arrecadacaoId, evolutionMessageId, rawRecord }) {
  if (!rawRecord) return null;

  const thumb = extractDocumentThumbnail(rawRecord);
  const meta = extractDocumentMeta(rawRecord);
  const updates = [];
  const params = [];
  let previewKey = null;

  if (thumb?.length) {
    previewKey = buildLocalMediaKey(arrecadacaoId, evolutionMessageId, '-preview.jpg');
    await saveLocalMedia(previewKey, thumb);
    updates.push('midia_preview_path = ?');
    params.push(previewKey);
  }

  if (meta.fileSize) {
    updates.push('midia_file_size = ?');
    params.push(meta.fileSize);
  }
  if (meta.pageCount) {
    updates.push('midia_page_count = ?');
    params.push(meta.pageCount);
  }

  if (!updates.length) return null;

  params.push(mensagemId);
  await pool.query(`UPDATE whatsapp_mensagens SET ${updates.join(', ')} WHERE id = ?`, params);
  return previewKey;
}

function extractBase64Payload(response) {
  if (!response) return null;
  if (response.base64) {
    return {
      buffer: Buffer.from(response.base64, 'base64'),
      mimetype: response.mimetype || null,
      fileName: response.fileName || null,
    };
  }
  if (response?.data?.base64) {
    return {
      buffer: Buffer.from(response.data.base64, 'base64'),
      mimetype: response.data.mimetype || response.mimetype || null,
      fileName: response.data.fileName || response.fileName || null,
    };
  }
  return null;
}

async function fetchMediaBuffer(rawRecord, tipo) {
  const embedded = extractMediaBase64FromRecord(rawRecord, tipo);
  if (embedded?.buffer?.length) {
    if (isValidMediaBuffer(embedded.buffer, embedded.mimetype, tipo)) return embedded;
  }

  try {
    const response = await getBase64FromMediaMessage(rawRecord, {
      convertToMp4: tipo === 'video',
    });
    const payload = extractBase64Payload(response);
    if (payload?.buffer?.length && isValidMediaBuffer(payload.buffer, payload.mimetype, tipo)) {
      return payload;
    }
  } catch (err) {
    const message = String(err.message || '');
    if (message.includes('Failed to fetch stream') || message.includes('410')) {
      return { error: 'Mídia expirada no WhatsApp' };
    }
    return { error: message };
  }

  const direct = await tryDirectMediaUrl(rawRecord, tipo);
  if (direct?.buffer?.length) return direct;

  return { error: 'Mídia indisponível na Evolution API' };
}

async function readValidatedStoredMedia(row) {
  const buffer = await readStoredMedia(row);
  if (!buffer?.length) return null;
  if (isValidMediaBuffer(buffer, row.midia_mimetype, row.tipo)) return buffer;
  return null;
}

async function markMirrorError(pool, mensagemId, errorMessage) {
  const msg = String(errorMessage || 'erro desconhecido').slice(0, 250);
  await pool.query(`UPDATE whatsapp_mensagens SET midia_mirror_erro = ? WHERE id = ?`, [msg, mensagemId]);
}

async function clearMirrorError(pool, mensagemId) {
  await pool.query(`UPDATE whatsapp_mensagens SET midia_mirror_erro = NULL WHERE id = ?`, [mensagemId]);
}

export async function mirrorWhatsappMedia(
  pool,
  { mensagemId, arrecadacaoId, evolutionMessageId, tipo, mimetype, rawRecord, forceRetry = false },
) {
  if (!isWhatsappMediaTipo(tipo)) return null;

  const [existing] = await pool.query(
    `SELECT midia_storage_path, midia_mirror_erro FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
    [mensagemId],
  );
  if (existing[0]?.midia_storage_path) {
    const storagePath = existing[0].midia_storage_path;
    if (isLocalMediaPath(storagePath)) {
      if (await localMediaExists(storagePath)) {
        const [fullRow] = await pool.query(
          `SELECT midia_mimetype, tipo FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
          [mensagemId],
        );
        const stored = await readValidatedStoredMedia({
          midia_storage_path: storagePath,
          midia_mimetype: fullRow[0]?.midia_mimetype,
          tipo: fullRow[0]?.tipo,
        });
        if (stored) {
          if (tipo === 'document') {
            const [previewRow] = await pool.query(
              `SELECT midia_preview_path FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
              [mensagemId],
            );
            if (!previewRow[0]?.midia_preview_path) {
              let previewRecord = rawRecord || null;
              if (!previewRecord) {
                const [row] = await pool.query(
                  `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo
                   FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
                  [mensagemId],
                );
                if (row[0]) {
                  const candidates = await resolveEvolutionMediaRecords(pool, row[0]);
                  previewRecord = candidates[0] || null;
                }
              }
              if (previewRecord) {
                await saveDocumentPreviewFromRecord(pool, {
                  mensagemId,
                  arrecadacaoId,
                  evolutionMessageId,
                  rawRecord: previewRecord,
                });
              }
            }
          }
          return { storagePath, alreadyStored: true };
        }
        console.warn(`mirrorWhatsappMedia ${mensagemId}: arquivo local inválido, rebaixando`);
      }
      await pool.query(`UPDATE whatsapp_mensagens SET midia_storage_path = NULL WHERE id = ?`, [
        mensagemId,
      ]);
    } else if (!forceRetry) {
      return { storagePath, alreadyStored: true };
    }
  }
  if (existing[0]?.midia_mirror_erro && !forceRetry) {
    return { skipped: true, error: existing[0].midia_mirror_erro };
  }
  if (forceRetry && existing[0]?.midia_mirror_erro) {
    await clearMirrorError(pool, mensagemId);
  }

  let media = null;
  let sourceRecord = rawRecord || null;
  if (rawRecord) {
    media = await fetchMediaBuffer(rawRecord, tipo);
  }
  if (media?.error || !media?.buffer?.length) {
    const [row] = await pool.query(
      `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo
       FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
      [mensagemId],
    );
    if (row[0]) {
      const candidates = await resolveEvolutionMediaRecords(pool, row[0]);
      for (const candidate of candidates) {
        media = await fetchMediaBuffer(candidate, tipo);
        if (media?.buffer?.length) {
          sourceRecord = candidate;
          break;
        }
      }
    }
  }

  if (media?.error) {
    await markMirrorError(pool, mensagemId, media.error);
    return { failed: true, error: media.error };
  }
  if (!media?.buffer?.length) {
    await markMirrorError(pool, mensagemId, 'Mídia vazia ou indisponível');
    return { failed: true, error: 'Mídia vazia ou indisponível' };
  }

  const finalMimetype = media.mimetype || mimetype || 'application/octet-stream';

  return storeMediaBuffer(pool, {
    mensagemId,
    arrecadacaoId,
    evolutionMessageId,
    tipo,
    mimetype: finalMimetype,
    fileName: media.fileName,
    buffer: media.buffer,
    rawRecord: sourceRecord,
  });
}

export async function getWhatsappMensagemMedia(pool, mensagemId) {
  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo,
            midia_storage_path, midia_preview_path, midia_mimetype, midia_url, midia_mirror_erro
     FROM whatsapp_mensagens
     WHERE id = ?
     LIMIT 1`,
    [mensagemId],
  );
  return rows[0] || null;
}

function sendMediaBuffer(res, buffer, mimetype) {
  res.setHeader('Content-Type', mimetype || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(cloneMediaBuffer(buffer));
}

async function tryEvolutionMediaStream(pool, row, res) {
  const candidates = await resolveEvolutionMediaRecords(pool, row);
  for (const rawRecord of candidates) {
    const media = await fetchMediaBuffer(rawRecord, row.tipo);
    if (!media?.buffer?.length) continue;

    const mimetype = media.mimetype || row.midia_mimetype || 'application/octet-stream';
    sendMediaBuffer(res, media.buffer, mimetype);
    await clearMirrorError(pool, row.id);
    await storeMediaBuffer(pool, {
      mensagemId: row.id,
      arrecadacaoId: row.arrecadacao_id,
      evolutionMessageId: row.evolution_message_id,
      tipo: row.tipo,
      mimetype,
      fileName: media.fileName,
      buffer: media.buffer,
      rawRecord,
    });
    return true;
  }
  return false;
}

export async function streamWhatsappMensagemMedia(pool, mensagemId, res, { preview = false } = {}) {
  const row = await getWhatsappMensagemMedia(pool, mensagemId);
  if (!row) {
    throw Object.assign(new Error('Mídia não encontrada'), { status: 404 });
  }

  if (preview) {
    if (!row.midia_preview_path) {
      throw Object.assign(new Error('Prévia não disponível'), { status: 404 });
    }
    const buffer = await readLocalMedia(row.midia_preview_path);
    if (!buffer?.length) {
      throw Object.assign(new Error('Prévia não disponível'), { status: 404 });
    }
    sendMediaBuffer(res, buffer, 'image/jpeg');
    return;
  }

  if (row.midia_storage_path) {
    try {
      const buffer = await readValidatedStoredMedia(row);
      if (buffer?.length) {
        res.setHeader('Content-Type', row.midia_mimetype || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.send(buffer);
        return;
      }
      if (await readStoredMedia(row)) {
        console.warn(`streamWhatsappMensagemMedia ${mensagemId}: mídia local corrompida, rebaixando`);
        await pool.query(`UPDATE whatsapp_mensagens SET midia_storage_path = NULL WHERE id = ?`, [
          mensagemId,
        ]);
        row.midia_storage_path = null;
      }
    } catch (err) {
      console.warn(`readStoredMedia ${mensagemId}:`, err.message);
    }
  }

  if (isWhatsappMediaTipo(row.tipo)) {
    const streamed = await tryEvolutionMediaStream(pool, row, res);
    if (streamed) return;
  }

  if (row.midia_url) {
    try {
      const remote = await fetch(row.midia_url);
      if (remote.ok) {
        const buffer = Buffer.from(await remote.arrayBuffer());
        res.setHeader(
          'Content-Type',
          row.midia_mimetype || remote.headers.get('content-type') || 'application/octet-stream',
        );
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(buffer);
        return;
      }
    } catch (err) {
      console.warn(`fetch midia_url ${mensagemId}:`, err.message);
    }
  }

  throw Object.assign(new Error('Mídia não disponível'), { status: 404 });
}

export async function backfillWhatsappMediaForLead(
  pool,
  arrecadacaoId,
  recordsByEvolutionId,
  { limit = BACKFILL_MAX_PER_SYNC } = {},
) {
  const max = Math.min(Math.max(limit, 1), 50);

  const [rows] = await pool.query(
    `SELECT id, evolution_message_id, remote_jid, direcao, tipo, midia_mimetype, midia_mirror_erro
     FROM whatsapp_mensagens
     WHERE arrecadacao_id = ?
       AND tipo IN ('image', 'audio', 'video', 'document', 'sticker')
       AND (midia_storage_path IS NULL OR midia_storage_path LIKE 'file:%')
     ORDER BY enviado_em DESC
     LIMIT ?`,
    [arrecadacaoId, max],
  );

  let mirrored = 0;
  let failed = 0;

  for (const row of rows) {
    let rawRecord = recordsByEvolutionId?.get(row.evolution_message_id);
    if (!rawRecord) {
      const candidates = await resolveEvolutionMediaRecords(pool, {
        ...row,
        arrecadacao_id: arrecadacaoId,
      });
      rawRecord = candidates[0];
      await sleep(BACKFILL_DELAY_MS);
    }
    if (!rawRecord) continue;
    try {
      const result = await mirrorWhatsappMedia(pool, {
        mensagemId: row.id,
        arrecadacaoId,
        evolutionMessageId: row.evolution_message_id,
        tipo: row.tipo,
        mimetype: row.midia_mimetype,
        rawRecord,
        forceRetry: true,
      });
      if (result?.storagePath && !result.alreadyStored) mirrored += 1;
      if (result?.failed) failed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`backfillWhatsappMedia ${row.id}:`, err.message);
    }
    await sleep(BACKFILL_DELAY_MS);
  }

  if (mirrored || failed) {
    console.info(`WhatsApp mídia lead ${arrecadacaoId}: ${mirrored} copiada(s), ${failed} falha(s)`);
  }

  return mirrored;
}

export async function backfillWhatsappMediaForParticipante(
  pool,
  eventoId,
  participanteId,
  { limit = 50, order = 'desc' } = {},
) {
  const max = Math.min(Math.max(limit, 1), 200);
  const sort = order === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await pool.query(
    `SELECT wm.id, wm.arrecadacao_id, wm.evolution_message_id, wm.remote_jid, wm.direcao, wm.tipo,
            wm.midia_mimetype
     FROM whatsapp_mensagens wm
     JOIN arrecadacao a ON a.id = wm.arrecadacao_id
     WHERE a.evento_id = ? AND a.participante_id = ?
       AND wm.tipo IN ('image', 'audio', 'video', 'document', 'sticker')
       AND (wm.midia_storage_path IS NULL OR wm.midia_mirror_erro IS NOT NULL)
     ORDER BY wm.enviado_em ${sort}
     LIMIT ?`,
    [eventoId, participanteId, max],
  );

  let mirrored = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const candidates = await resolveEvolutionMediaRecords(pool, row);
      let result = null;
      for (const rawRecord of candidates) {
        result = await mirrorWhatsappMedia(pool, {
          mensagemId: row.id,
          arrecadacaoId: row.arrecadacao_id,
          evolutionMessageId: row.evolution_message_id,
          tipo: row.tipo,
          mimetype: row.midia_mimetype,
          rawRecord,
          forceRetry: true,
        });
        if (result?.storagePath || result?.buffer) break;
        if (result?.failed) break;
      }
      if (result?.storagePath && !result.alreadyStored) mirrored += 1;
      if (result?.failed) failed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`backfill media participante ${row.id}:`, err.message);
    }
    await sleep(BACKFILL_DELAY_MS);
  }

  if (mirrored || failed) {
    console.info(
      `WhatsApp mídia participante ${participanteId}: ${mirrored} copiada(s), ${failed} falha(s)`,
    );
  }

  return { mirrored, failed, total: rows.length };
}

export async function processPendingWhatsappMediaBatch(
  pool,
  { limit = MEDIA_WORKER_BATCH, eventoId, participanteId, arrecadacaoId } = {},
) {
  const max = Math.min(Math.max(limit, 1), 20);
  const params = [];
  let sql = `
    SELECT wm.id, wm.arrecadacao_id, wm.evolution_message_id, wm.remote_jid, wm.direcao,
           wm.tipo, wm.midia_mimetype, wm.midia_storage_path
    FROM whatsapp_mensagens wm
    JOIN arrecadacao a ON a.id = wm.arrecadacao_id
    WHERE wm.tipo IN ('image', 'audio', 'video', 'document', 'sticker')
      AND wm.enviado_em >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      AND (
        wm.midia_storage_path IS NULL
        OR wm.midia_storage_path LIKE 'file:%'
        OR wm.midia_mirror_erro IS NOT NULL
      )`;

  if (eventoId) {
    sql += ' AND a.evento_id = ?';
    params.push(eventoId);
  }
  if (participanteId) {
    sql += ' AND a.participante_id = ?';
    params.push(participanteId);
  }
  if (arrecadacaoId) {
    sql += ' AND wm.arrecadacao_id = ?';
    params.push(arrecadacaoId);
  }

  sql += ' ORDER BY wm.enviado_em DESC LIMIT ?';
  params.push(max);

  const [rows] = await pool.query(sql, params);
  const mirrored = [];

  for (const row of rows) {
    if (row.midia_storage_path && isLocalMediaPath(row.midia_storage_path)) {
      if (await localMediaExists(row.midia_storage_path)) {
        const valid = await readValidatedStoredMedia(row);
        if (valid) continue;
        await pool.query(`UPDATE whatsapp_mensagens SET midia_storage_path = NULL WHERE id = ?`, [
          row.id,
        ]);
        row.midia_storage_path = null;
      }
    } else if (row.midia_storage_path) {
      continue;
    }

    try {
      const candidates = await resolveEvolutionMediaRecords(pool, row);
      let result = null;
      for (const rawRecord of candidates) {
        result = await mirrorWhatsappMedia(pool, {
          mensagemId: row.id,
          arrecadacaoId: row.arrecadacao_id,
          evolutionMessageId: row.evolution_message_id,
          tipo: row.tipo,
          mimetype: row.midia_mimetype,
          rawRecord,
          forceRetry: true,
        });
        if (result?.storagePath) break;
        if (result?.failed) break;
      }
      if (result?.storagePath && !result.alreadyStored) {
        mirrored.push({ id: row.id, arrecadacaoId: row.arrecadacao_id });
      }
    } catch (err) {
      console.warn(`processPendingWhatsappMedia ${row.id}:`, err.message);
    }
    await sleep(BACKFILL_DELAY_MS);
  }

  return mirrored;
}
