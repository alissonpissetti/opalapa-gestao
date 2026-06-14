import {
  nationalPhoneDigits,
  phoneFromRemoteJid,
  phoneSearchVariants,
  remoteJidFromPhone,
  isGroupJid,
  resolveChatRemoteJid,
  chatJidMatchesPhone,
} from './whatsapp-phone.js';
import {
  getEvolutionConfig,
  getConnectionState,
  sendTextMessage,
  ensureInstance,
  connectInstance,
  logoutInstance,
  extractQrPayload,
  parseConnectionState,
  isConnectedState,
  configureInstanceWebhook,
  resolveRemoteJidsForPhone,
  fetchChatMessagesSince,
  fetchGlobalReactionMessagesSince,
  sendReactionMessage,
} from './evolution.js';
import { broadcastWhatsappEvent } from './whatsapp-ws.js';
import { getParticipanteIdForArrecadacao } from './whatsapp-participants.js';
import {
  isWhatsappMediaTipo,
  midiaUrlForMensagemRow,
  backfillWhatsappMediaForLead,
  schedulePersistMediaFromRecord,
} from './whatsapp-media.js';

async function emitWhatsappMessage(pool, arrecadacaoId, mensagem) {
  if (!mensagem) return;
  const participanteId = await getParticipanteIdForArrecadacao(pool, arrecadacaoId);
  broadcastWhatsappEvent('message', { arrecadacaoId, participanteId, mensagem });
}

async function emitWhatsappReaction(pool, arrecadacaoId, payload) {
  if (!payload?.mensagemId) return;
  const participanteId = await getParticipanteIdForArrecadacao(pool, arrecadacaoId);
  broadcastWhatsappEvent('reaction', { arrecadacaoId, participanteId, ...payload });
}

function rowToReacao(row) {
  return {
    emoji: normalizeEmoji(row.emoji),
    autorKey: row.autor_key,
    fromMe: Boolean(row.from_me),
  };
}

async function emitWhatsappMessageMedia(pool, arrecadacaoId, mensagem) {
  if (!mensagem) return;
  const participanteId = await getParticipanteIdForArrecadacao(pool, arrecadacaoId);
  broadcastWhatsappEvent('message_media', { arrecadacaoId, participanteId, mensagem });
}

function resolveMidiaUrl(row) {
  return midiaUrlForMensagemRow(row);
}

function rowToMensagem(row, reacoes = []) {
  return {
    id: row.id,
    arrecadacaoId: Number(row.arrecadacao_id),
    evolutionMessageId: row.evolution_message_id,
    remoteJid: row.remote_jid,
    direcao: row.direcao,
    tipo: row.tipo,
    texto: row.texto || '',
    midiaUrl: resolveMidiaUrl(row),
    midiaMimetype: row.midia_mimetype || null,
    enviadoEm: row.enviado_em ? new Date(row.enviado_em).toISOString() : null,
    criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : null,
    reacoes,
  };
}

async function loadMensagemById(pool, mensagemId) {
  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto,
            midia_url, midia_mimetype, midia_storage_path, enviado_em, criado_em
     FROM whatsapp_mensagens
     WHERE id = ?
     LIMIT 1`,
    [mensagemId],
  );
  if (!rows[0]) return null;
  const [mensagem] = await attachReactionsToMensagens(pool, [rowToMensagem(rows[0])]);
  return mensagem;
}

function scheduleMirrorWhatsappMedia(pool, params) {
  schedulePersistMediaFromRecord(pool, params, async () => {
    const mensagem = await loadMensagemById(pool, params.mensagemId);
    if (!mensagem) return;
    await emitWhatsappMessageMedia(pool, params.arrecadacaoId, mensagem);
  });
}

export function normalizeEmoji(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8').trim();
  if (typeof value === 'object') {
    if (Array.isArray(value.data)) return Buffer.from(value.data).toString('utf8').trim();
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data).toString('utf8').trim();
    }
    if (typeof value.text === 'string') return value.text.trim();
    if (typeof value.reaction === 'string') return value.reaction.trim();
    if (typeof value.emoji === 'string') return value.emoji.trim();
  }
  return String(value).trim();
}

export function extractMessageContent(message) {
  if (!message || typeof message !== 'object') {
    return { tipo: 'unknown', texto: '', midiaUrl: null, midiaMimetype: null };
  }

  if (message.conversation) {
    return { tipo: 'text', texto: message.conversation, midiaUrl: null, midiaMimetype: null };
  }
  if (message.extendedTextMessage?.text) {
    return {
      tipo: 'text',
      texto: message.extendedTextMessage.text,
      midiaUrl: null,
      midiaMimetype: null,
    };
  }
  if (message.imageMessage) {
    return {
      tipo: 'image',
      texto: message.imageMessage.caption || '',
      midiaUrl: message.imageMessage.url || null,
      midiaMimetype: message.imageMessage.mimetype || null,
    };
  }
  if (message.audioMessage) {
    return {
      tipo: 'audio',
      texto: '[Áudio]',
      midiaUrl: message.audioMessage.url || null,
      midiaMimetype: message.audioMessage.mimetype || null,
    };
  }
  if (message.videoMessage) {
    return {
      tipo: 'video',
      texto: message.videoMessage.caption || '[Vídeo]',
      midiaUrl: message.videoMessage.url || null,
      midiaMimetype: message.videoMessage.mimetype || null,
    };
  }
  if (message.documentMessage) {
    return {
      tipo: 'document',
      texto: message.documentMessage.fileName || message.documentMessage.title || '[Documento]',
      midiaUrl: message.documentMessage.url || null,
      midiaMimetype: message.documentMessage.mimetype || null,
    };
  }
  if (message.stickerMessage) {
    return {
      tipo: 'sticker',
      texto: '[Figurinha]',
      midiaUrl: message.stickerMessage.url || null,
      midiaMimetype: message.stickerMessage.mimetype || null,
    };
  }

  if (message.reactionMessage) {
    return { tipo: 'reaction', texto: '', midiaUrl: null, midiaMimetype: null };
  }

  return { tipo: 'unknown', texto: '[Mensagem não suportada]', midiaUrl: null, midiaMimetype: null };
}

function parseMessagePayload(message) {
  if (!message) return null;
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message);
      return typeof parsed === 'object' && parsed ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof message === 'object') return message;
  return null;
}

function findReactionMessageDeep(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (node.reactionMessage && typeof node.reactionMessage === 'object') return node.reactionMessage;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    const found = findReactionMessageDeep(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export function isReactionRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const messageType = String(record.messageType || record.type || '').toLowerCase();
  if (messageType.includes('reaction')) return true;
  return Boolean(extractReactionFromRecord(record));
}

export function isReactionGhostMessage(row) {
  if (!row) return false;
  if (row.tipo === 'reaction') return true;
  return row.tipo === 'unknown' && String(row.texto || '') === '[Mensagem não suportada]';
}

export function extractReactionFromRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const message = parseMessagePayload(record.message);
  const reaction =
    message?.reactionMessage ||
    record.reactionMessage ||
    findReactionMessageDeep(message) ||
    findReactionMessageDeep(record);

  if (!reaction) return null;

  const targetKey = reaction.key || {};
  const targetId = targetKey.id;
  if (!targetId) return null;

  const emoji = normalizeEmoji(
    reaction.text ?? reaction.reaction ?? reaction.emoji ?? reaction.content,
  );

  const reactorFromKey = record.reactorKey || record.reactor?.key || {};
  const senderKey = record.key || {};
  const fromMe = Boolean(reactorFromKey.fromMe ?? senderKey.fromMe);
  const reactorKey = fromMe
    ? 'me'
    : String(
        reactorFromKey.participant ||
          reactorFromKey.participantAlt ||
          reactorFromKey.remoteJidAlt ||
          reactorFromKey.remoteJid ||
          senderKey.participant ||
          senderKey.participantAlt ||
          senderKey.remoteJidAlt ||
          senderKey.remoteJid ||
          '',
      ).trim() || 'unknown';

  return {
    targetEvolutionMessageId: String(targetId),
    emoji,
    fromMe,
    reactorKey,
    remoteJid: resolveChatRemoteJid(record) || String(senderKey.remoteJid || targetKey.remoteJid || ''),
  };
}

function messageTimestampToDate(ts) {
  if (ts == null) return new Date();
  const n = Number(ts);
  if (!Number.isFinite(n)) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

export function normalizeWebhookMessages(payload) {
  if (!payload) return [];
  const event = String(payload.event || payload.type || '').toLowerCase();
  if (event === 'messages.update' || event.includes('messages_update')) return [];
  if (event && !event.includes('message') && event !== 'send.message') return [];

  let data = payload.data ?? payload;
  if (data?.messages) data = data.messages;
  if (data?.records) data = data.records;
  if (!Array.isArray(data)) data = [data];

  return data
    .map((item) => normalizeEvolutionWebhookItem(item) || item)
    .filter((item) => {
      if (!item?.key?.remoteJid) return false;
      if (item.update?.reactions) return false;
      return !isReactionRecord(item);
    });
}

export function normalizeWebhookReactions(payload) {
  if (!payload) return [];
  const event = String(payload.event || payload.type || '').toLowerCase();

  let data = payload.data ?? payload;
  if (data?.messages) data = data.messages;
  if (data?.records) data = data.records;
  if (!Array.isArray(data)) data = [data];

  const reactions = [];

  for (const rawItem of data) {
    const item = normalizeEvolutionWebhookItem(rawItem);
    if (!item || typeof item !== 'object') continue;

    if (item.message?.reactionMessage || findReactionMessageDeep(parseMessagePayload(item.message))) {
      reactions.push(item);
      continue;
    }

    if (String(item.messageType || item.type || '').toLowerCase().includes('reaction')) {
      reactions.push(item);
      continue;
    }

    if (item.reactionMessage) {
      reactions.push({
        key: item.key,
        message: { reactionMessage: item.reactionMessage },
        messageTimestamp: item.messageTimestamp,
      });
      continue;
    }

    if (rawItem?.update?.reactions && Array.isArray(rawItem.update.reactions) && item.key?.id) {
      for (const reaction of rawItem.update.reactions) {
        const reactorKey = reaction.key || {};
        reactions.push({
          key: {
            remoteJid: item.key.remoteJid,
            fromMe: reactorKey.fromMe ?? false,
            participant: reactorKey.participant,
            id: reaction.key?.id || item.key.id,
          },
          reactorKey: reactorKey,
          message: {
            reactionMessage: {
              key: {
                id: item.key.id,
                remoteJid: item.key.remoteJid,
                fromMe: item.key.fromMe,
              },
              text: normalizeEmoji(reaction.text ?? reaction.emoji ?? reaction.reaction ?? ''),
            },
          },
          messageTimestamp: item.messageTimestamp || Date.now() / 1000,
        });
      }
      continue;
    }

    if (event.includes('update') && item.message?.reactionMessage) {
      reactions.push(item);
      continue;
    }

    if (event.includes('reaction') && item.key) {
      reactions.push(item);
    }
  }

  return reactions.filter((item) => isReactionRecord(item));
}

export async function migrateWhatsapp(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      arrecadacao_id INT UNSIGNED NOT NULL,
      evolution_message_id VARCHAR(128) NOT NULL,
      remote_jid VARCHAR(80) NOT NULL,
      direcao ENUM('in', 'out') NOT NULL,
      tipo VARCHAR(24) NOT NULL DEFAULT 'text',
      texto TEXT NULL,
      midia_url VARCHAR(2048) NULL,
      midia_mimetype VARCHAR(120) NULL,
      midia_storage_path VARCHAR(512) NULL,
      midia_mirror_erro VARCHAR(255) NULL,
      enviado_em DATETIME(3) NOT NULL,
      criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_wa_msg_lead (arrecadacao_id, evolution_message_id),
      INDEX idx_wa_lead_time (arrecadacao_id, enviado_em),
      CONSTRAINT fk_wa_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_reacoes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      mensagem_id INT UNSIGNED NOT NULL,
      autor_key VARCHAR(120) NOT NULL,
      emoji VARCHAR(32) NOT NULL DEFAULT '',
      from_me TINYINT(1) NOT NULL DEFAULT 0,
      atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_wa_reacao_msg_autor (mensagem_id, autor_key),
      INDEX idx_wa_reacao_msg (mensagem_id),
      CONSTRAINT fk_wa_reacao_mensagem
        FOREIGN KEY (mensagem_id) REFERENCES whatsapp_mensagens(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await pool.query(
      `ALTER TABLE whatsapp_mensagens
       ADD COLUMN midia_storage_path VARCHAR(512) NULL AFTER midia_mimetype`,
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  try {
    await pool.query(
      `ALTER TABLE whatsapp_mensagens
       ADD COLUMN midia_mirror_erro VARCHAR(255) NULL AFTER midia_storage_path`,
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function loadReactionsByMensagemIds(pool, mensagemIds) {
  const map = new Map();
  if (!mensagemIds.length) return map;

  const placeholders = mensagemIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT mensagem_id, autor_key, emoji, from_me
     FROM whatsapp_reacoes
     WHERE mensagem_id IN (${placeholders})
     ORDER BY atualizado_em ASC, id ASC`,
    mensagemIds,
  );

  for (const row of rows) {
    if (!map.has(row.mensagem_id)) map.set(row.mensagem_id, []);
    map.get(row.mensagem_id).push(rowToReacao(row));
  }
  return map;
}

async function loadReactionsByEvolutionMessageIds(pool, evolutionMessageIds) {
  const map = new Map();
  if (!evolutionMessageIds.length) return map;

  const placeholders = evolutionMessageIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT wm.evolution_message_id, wr.autor_key, wr.emoji, wr.from_me
     FROM whatsapp_reacoes wr
     JOIN whatsapp_mensagens wm ON wm.id = wr.mensagem_id
     WHERE wm.evolution_message_id IN (${placeholders})
     ORDER BY wr.atualizado_em ASC, wr.id ASC`,
    evolutionMessageIds,
  );

  for (const row of rows) {
    const evoId = row.evolution_message_id;
    if (!map.has(evoId)) map.set(evoId, []);
    const list = map.get(evoId);
    const reacao = rowToReacao(row);
    const idx = list.findIndex((item) => item.autorKey === reacao.autorKey);
    if (idx >= 0) list[idx] = reacao;
    else list.push(reacao);
  }
  return map;
}

export async function attachReactionsToMensagens(pool, mensagens) {
  if (!mensagens.length) return mensagens;

  const evolutionIds = [
    ...new Set(mensagens.map((m) => m.evolutionMessageId).filter(Boolean)),
  ];
  const reactionsByEvolutionId = await loadReactionsByEvolutionMessageIds(pool, evolutionIds);

  const missingIds = mensagens
    .filter((m) => !reactionsByEvolutionId.has(m.evolutionMessageId))
    .map((m) => m.id);
  const reactionsByMensagemId = await loadReactionsByMensagemIds(pool, missingIds);

  return mensagens.map((m) => ({
    ...m,
    reacoes:
      reactionsByEvolutionId.get(m.evolutionMessageId) ||
      reactionsByMensagemId.get(m.id) ||
      [],
  }));
}

async function getReactionsForMensagem(pool, mensagemId) {
  const [rows] = await pool.query(
    `SELECT autor_key, emoji, from_me
     FROM whatsapp_reacoes
     WHERE mensagem_id = ?
     ORDER BY atualizado_em ASC, id ASC`,
    [mensagemId],
  );
  return rows.map(rowToReacao);
}

async function applyReaction(pool, mensagemId, { emoji, autorKey, fromMe }) {
  if (!emoji) {
    await pool.query(`DELETE FROM whatsapp_reacoes WHERE mensagem_id = ? AND autor_key = ?`, [
      mensagemId,
      autorKey,
    ]);
    return;
  }

  await pool.query(
    `INSERT INTO whatsapp_reacoes (mensagem_id, autor_key, emoji, from_me, atualizado_em)
     VALUES (?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE
       emoji = VALUES(emoji),
       from_me = VALUES(from_me),
       atualizado_em = VALUES(atualizado_em)`,
    [mensagemId, autorKey, emoji, fromMe ? 1 : 0],
  );
}

export async function getLeadPhone(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `SELECT p.contato_telefone
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.id = ?
     LIMIT 1`,
    [arrecadacaoId],
  );
  return rows[0]?.contato_telefone || '';
}

export async function findArrecadacaoIdsByPhone(pool, phone) {
  const variants = phoneSearchVariants(phone)
    .map((v) => nationalPhoneDigits(v))
    .filter((v) => v.length >= 10);
  const unique = [...new Set(variants)];
  if (!unique.length) return [];

  const [rows] = await pool.query(
    `SELECT DISTINCT a.id
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE p.contato_telefone IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return rows.map((r) => Number(r.id));
}

async function pickPrimaryLeadIds(pool, leadIds) {
  if (!leadIds?.length) return [];
  if (leadIds.length === 1) return leadIds;

  const placeholders = leadIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT MIN(a.id) AS id
     FROM arrecadacao a
     WHERE a.id IN (${placeholders})
     GROUP BY a.participante_id`,
    leadIds,
  );
  return rows.map((r) => Number(r.id));
}

export async function insertWhatsappMessage(pool, arrecadacaoId, data) {
  const evolutionMessageId = String(data.evolutionMessageId || '').trim();
  if (!evolutionMessageId) return null;

  try {
    await pool.query(
      `INSERT INTO whatsapp_mensagens
         (arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto, midia_url, midia_mimetype, enviado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        arrecadacaoId,
        evolutionMessageId,
        data.remoteJid,
        data.direcao,
        data.tipo || 'text',
        data.texto || null,
        data.midiaUrl || null,
        data.midiaMimetype || null,
        data.enviadoEm,
      ],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return null;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto,
            midia_url, midia_mimetype, midia_storage_path, enviado_em, criado_em
     FROM whatsapp_mensagens
     WHERE arrecadacao_id = ? AND evolution_message_id = ?
     LIMIT 1`,
    [arrecadacaoId, evolutionMessageId],
  );
  return rows[0] ? rowToMensagem(rows[0]) : null;
}

function normalizeEvolutionWebhookItem(record) {
  if (!record || typeof record !== 'object') return null;

  const normalized = { ...record };
  const key = { ...(normalized.key || {}) };

  if (!key.id) {
    const keyId = normalized.keyId || normalized.messageId || normalized.id;
    if (keyId) key.id = String(keyId);
  }
  if (!key.remoteJid && normalized.remoteJid) {
    key.remoteJid = String(normalized.remoteJid);
  }
  if (key.fromMe == null && normalized.fromMe != null) {
    key.fromMe = Boolean(normalized.fromMe);
  }
  if (!key.participant && normalized.participant) {
    key.participant = String(normalized.participant);
  }
  if (!key.remoteJidAlt && normalized.key?.remoteJidAlt) {
    key.remoteJidAlt = String(normalized.key.remoteJidAlt);
  }
  if (!key.participantAlt && normalized.key?.participantAlt) {
    key.participantAlt = String(normalized.key.participantAlt);
  }

  if (!key.id || !key.remoteJid) return null;

  let message = parseMessagePayload(normalized.message);
  if (!message && normalized.reactionMessage) {
    message = { reactionMessage: normalized.reactionMessage };
  }
  if (!message && normalized.update?.message) {
    message = parseMessagePayload(normalized.update.message);
  }

  return { ...normalized, key, message };
}

function normalizeEvolutionRecord(record) {
  return normalizeEvolutionWebhookItem(record);
}

async function deleteReactionGhostMessages(pool, arrecadacaoId, evolutionMessageId) {
  if (!evolutionMessageId) return;
  await pool.query(
    `DELETE FROM whatsapp_mensagens
     WHERE arrecadacao_id = ?
       AND evolution_message_id = ?
       AND (tipo = 'reaction' OR (tipo = 'unknown' AND texto = '[Mensagem não suportada]'))`,
    [arrecadacaoId, evolutionMessageId],
  );
}

async function reconcileReactionRecords(pool, arrecadacaoId, records) {
  let cleaned = 0;
  let applied = 0;

  for (const rawRecord of records) {
    const record = normalizeEvolutionRecord(rawRecord);
    if (!record || !isReactionRecord(record)) continue;

    await deleteReactionGhostMessages(pool, arrecadacaoId, record.key.id);
    cleaned += 1;

    const result = await persistEvolutionReaction(pool, rawRecord, {
      arrecadacaoIds: [arrecadacaoId],
    });
    applied += result.saved || 0;
  }

  return { cleaned, applied };
}

export async function backfillReactionsForParticipante(
  pool,
  eventoId,
  participanteId,
  { days = 14, maxReactions = 200, maxPages = 40 } = {},
) {
  const [leadRows] = await pool.query(
    `SELECT a.id, p.contato_telefone
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.evento_id = ? AND a.participante_id = ?
     ORDER BY a.id ASC`,
    [eventoId, participanteId],
  );
  if (!leadRows.length) return { applied: 0 };

  const leadIds = leadRows.map((row) => Number(row.id));
  const phone = leadRows[0].contato_telefone || '';

  const [targetRows] = await pool.query(
    `SELECT DISTINCT wm.evolution_message_id
     FROM whatsapp_mensagens wm
     JOIN arrecadacao a ON a.id = wm.arrecadacao_id
     WHERE a.evento_id = ? AND a.participante_id = ?
       AND wm.evolution_message_id IS NOT NULL
       AND wm.tipo <> 'reaction'`,
    [eventoId, participanteId],
  );
  const targetIds = new Set(targetRows.map((row) => String(row.evolution_message_id)).filter(Boolean));
  if (!targetIds.size) return { applied: 0, leadIds, targets: 0 };

  const batch = await fetchGlobalReactionMessagesSince({ days, maxPages });
  const seen = new Set();
  let applied = 0;
  let scanned = 0;
  const max = Math.min(Math.max(maxReactions, 1), 500);

  for (const rawRecord of batch) {
    if (scanned >= max) break;

    const reaction = extractReactionFromRecord(rawRecord);
    if (!reaction?.targetEvolutionMessageId || !targetIds.has(reaction.targetEvolutionMessageId)) {
      continue;
    }

    const chatJid = resolveChatRemoteJid(rawRecord);
    if (chatJid && phone && !chatJidMatchesPhone(chatJid, phone)) {
      continue;
    }

    const reactionId = rawRecord?.key?.id;
    if (!reactionId || seen.has(reactionId)) continue;
    seen.add(reactionId);
    scanned += 1;

    const result = await persistEvolutionReaction(pool, rawRecord, { arrecadacaoIds: leadIds });
    applied += result.saved || 0;
  }

  return { applied, leadIds, scanned, targets: targetIds.size, source: 'global' };
}

export async function backfillReactionsForLead(pool, arrecadacaoId, { days = 14, maxReactions = 200 } = {}) {
  const [rows] = await pool.query(
    `SELECT a.evento_id, a.participante_id
     FROM arrecadacao a
     WHERE a.id = ?
     LIMIT 1`,
    [arrecadacaoId],
  );
  if (!rows[0]) return { applied: 0 };
  return backfillReactionsForParticipante(pool, rows[0].evento_id, rows[0].participante_id, {
    days,
    maxReactions,
  });
}

export async function persistEvolutionReaction(pool, rawMessage, { arrecadacaoIds } = {}) {
  const record = normalizeEvolutionRecord(rawMessage);
  const reaction = extractReactionFromRecord(record);
  if (!reaction) return { saved: 0 };

  const { targetEvolutionMessageId, emoji, fromMe, reactorKey } = reaction;
  let remoteJid = resolveChatRemoteJid(record) || reaction.remoteJid;

  if (!remoteJid || isGroupJid(remoteJid)) {
    const [targetRows] = await pool.query(
      `SELECT remote_jid
       FROM whatsapp_mensagens
       WHERE evolution_message_id = ?
         AND remote_jid NOT LIKE '%@g.us'
       ORDER BY id ASC
       LIMIT 1`,
      [targetEvolutionMessageId],
    );
    remoteJid = targetRows[0]?.remote_jid || remoteJid || '';
  }

  if (!remoteJid || isGroupJid(remoteJid)) return { saved: 0 };

  const phone = phoneFromRemoteJid(remoteJid);
  const leadIds =
    arrecadacaoIds?.length > 0 ? arrecadacaoIds : await findArrecadacaoIdsByPhone(pool, phone);
  if (!leadIds.length) return { saved: 0, phone };

  const placeholders = leadIds.map(() => '?').join(', ');
  let [targets] = await pool.query(
    `SELECT wm.id, wm.arrecadacao_id, wm.evolution_message_id
     FROM whatsapp_mensagens wm
     JOIN arrecadacao a ON a.id = wm.arrecadacao_id
     WHERE wm.evolution_message_id = ?
       AND a.participante_id IN (
         SELECT DISTINCT a2.participante_id
         FROM arrecadacao a2
         WHERE a2.id IN (${placeholders})
       )`,
    [targetEvolutionMessageId, ...leadIds],
  );

  if (!targets.length) {
    const [fallback] = await pool.query(
      `SELECT wm.id, wm.arrecadacao_id, wm.evolution_message_id
       FROM whatsapp_mensagens wm
       WHERE wm.evolution_message_id = ?
       ORDER BY wm.id ASC
       LIMIT 20`,
      [targetEvolutionMessageId],
    );
    targets = fallback;
  }

  if (!targets.length) return { saved: 0, phone, leadIds, pending: true };

  let saved = 0;
  const emitted = new Set();
  for (const target of targets) {
    await applyReaction(pool, target.id, { emoji, autorKey: reactorKey, fromMe });
    const reactionsMap = await loadReactionsByEvolutionMessageIds(pool, [target.evolution_message_id]);
    const reacoes = reactionsMap.get(target.evolution_message_id) || [];
    saved += 1;
    const emitKey = `${target.evolution_message_id}:${reactorKey}`;
    if (emitted.has(emitKey)) continue;
    emitted.add(emitKey);
    await emitWhatsappReaction(pool, target.arrecadacao_id, {
      mensagemId: target.id,
      evolutionMessageId: target.evolution_message_id,
      reacoes,
    });
  }

  return { saved, phone, leadIds };
}

export async function persistEmbeddedReactionsFromRecord(pool, rawRecord, { arrecadacaoIds } = {}) {
  const record = normalizeEvolutionRecord(rawRecord);
  if (!record?.key?.id) return { saved: 0 };

  const reactions =
    rawRecord?.reactions ||
    rawRecord?.message?.reactions ||
    record?.reactions ||
    record?.message?.reactions ||
    rawRecord?.update?.reactions ||
    record?.update?.reactions;

  if (!Array.isArray(reactions) || !reactions.length) return { saved: 0 };

  let saved = 0;
  const targetId = String(record.key.id);
  const remoteJid = String(record.key.remoteJid || '');

  for (const reaction of reactions) {
    const emoji = normalizeEmoji(reaction.text ?? reaction.emoji ?? reaction.reaction);
    const reactorKey = reaction.key || {};
    const synthetic = {
      key: {
        remoteJid,
        fromMe: reactorKey.fromMe,
        participant: reactorKey.participant,
        id: reactorKey.id,
      },
      message: {
        reactionMessage: {
          key: { id: targetId, remoteJid, fromMe: record.key.fromMe },
          text: emoji,
        },
      },
    };
    const result = await persistEvolutionReaction(pool, synthetic, { arrecadacaoIds });
    saved += result.saved || 0;
  }

  return { saved };
}

export async function persistEvolutionMessage(pool, rawMessage, { arrecadacaoIds } = {}) {
  const record = normalizeEvolutionRecord(rawMessage);
  if (!record) return { saved: 0 };

  if (isReactionRecord(record)) {
    const reaction = extractReactionFromRecord(record);
    if (reaction) {
      const phone = phoneFromRemoteJid(String(record.key?.remoteJid || ''));
      const leadIds =
        arrecadacaoIds?.length > 0
          ? arrecadacaoIds
          : await findArrecadacaoIdsByPhone(pool, phone);
      for (const leadId of leadIds) {
        await deleteReactionGhostMessages(pool, leadId, record.key.id);
      }
      return persistEvolutionReaction(pool, rawMessage, { arrecadacaoIds: leadIds });
    }
    return { saved: 0, skipped: true };
  }

  const key = record.key || {};
  const remoteJid = String(key.remoteJid || '');
  if (!remoteJid || isGroupJid(remoteJid)) return { saved: 0 };

  const phone = phoneFromRemoteJid(remoteJid);
  const leadIds = await pickPrimaryLeadIds(
    pool,
    arrecadacaoIds?.length > 0 ? arrecadacaoIds : await findArrecadacaoIdsByPhone(pool, phone),
  );
  if (!leadIds.length) return { saved: 0, phone };

  const content = extractMessageContent(record.message);
  const evolutionMessageId = String(key.id || '');
  if (!evolutionMessageId) return { saved: 0 };

  if (content.tipo === 'reaction') {
    return persistEvolutionReaction(pool, rawMessage, { arrecadacaoIds: leadIds });
  }

  const enviadoEm = messageTimestampToDate(record.messageTimestamp);
  const direcao = key.fromMe ? 'out' : 'in';

  let saved = 0;
  const emitted = new Set();
  for (const arrecadacaoId of leadIds) {
    const inserted = await insertWhatsappMessage(pool, arrecadacaoId, {
      evolutionMessageId,
      remoteJid,
      direcao,
      tipo: content.tipo,
      texto: content.texto,
      midiaUrl: content.midiaUrl,
      midiaMimetype: content.midiaMimetype,
      enviadoEm,
    });

    let row = inserted;
    if (!row) {
      const [existing] = await pool.query(
        `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto,
                midia_url, midia_mimetype, midia_storage_path, enviado_em, criado_em
         FROM whatsapp_mensagens
         WHERE arrecadacao_id = ? AND evolution_message_id = ?
         LIMIT 1`,
        [arrecadacaoId, evolutionMessageId],
      );
      row = existing[0] ? rowToMensagem(existing[0]) : null;
    } else {
      saved += 1;
    }

    if (row) {
      if (isWhatsappMediaTipo(content.tipo)) {
        const [mediaRow] = await pool.query(
          `SELECT midia_storage_path FROM whatsapp_mensagens WHERE id = ? LIMIT 1`,
          [row.id],
        );
        if (!mediaRow[0]?.midia_storage_path) {
          scheduleMirrorWhatsappMedia(pool, {
            mensagemId: row.id,
            arrecadacaoId,
            evolutionMessageId,
            tipo: content.tipo,
            mimetype: content.midiaMimetype,
            rawRecord: record,
          });
        }
      }
      if (inserted) {
        const participanteId = await getParticipanteIdForArrecadacao(pool, arrecadacaoId);
        const emitKey = `${participanteId || arrecadacaoId}:${evolutionMessageId}`;
        if (!emitted.has(emitKey)) {
          emitted.add(emitKey);
          await emitWhatsappMessage(pool, arrecadacaoId, row);
        }
      }
    }
  }

  await persistEmbeddedReactionsFromRecord(pool, rawMessage, { arrecadacaoIds: leadIds });

  return { saved, phone, leadIds };
}

export async function handleEvolutionWebhook(pool, payload) {
  const reactions = normalizeWebhookReactions(payload);
  const messages = normalizeWebhookMessages(payload);
  let saved = 0;
  let reactionUpdates = 0;

  for (const item of reactions) {
    const result = await persistEvolutionReaction(pool, item);
    reactionUpdates += result.saved || 0;
  }

  for (const msg of messages) {
    const record = normalizeEvolutionRecord(msg);
    if (!record || isReactionRecord(record)) continue;
    const result = await persistEvolutionMessage(pool, msg);
    saved += result.saved || 0;
  }

  return {
    ok: true,
    saved,
    reactions: reactionUpdates,
    count: messages.length + reactions.length,
  };
}

export async function syncWhatsappHistory(pool, arrecadacaoId, { days = 5, mediaBackfillLimit } = {}) {
  const phone = await getLeadPhone(pool, arrecadacaoId);
  if (!phone) {
    throw Object.assign(new Error('Lead sem WhatsApp cadastrado'), { status: 400 });
  }

  const remoteJids = await resolveRemoteJidsForPhone(phone);
  if (!remoteJids.length) {
    throw Object.assign(new Error('WhatsApp inválido no cadastro do lead'), { status: 400 });
  }

  const seen = new Set();
  const records = [];
  for (const remoteJid of remoteJids) {
    const batch = await fetchChatMessagesSince(remoteJid, { days });
    for (const record of batch) {
      const id = record?.key?.id || record?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      records.push(record);
    }
  }

  const recordsByEvolutionId = new Map();
  for (const record of records) {
    const id = record?.key?.id || record?.id;
    if (id) recordsByEvolutionId.set(String(id), record);
  }

  let imported = 0;

  for (const record of records) {
    const normalized = normalizeEvolutionRecord(record);
    if (normalized && isReactionRecord(normalized)) continue;
    const result = await persistEvolutionMessage(pool, record, {
      arrecadacaoIds: [arrecadacaoId],
    });
    imported += result.saved || 0;
  }

  await pool.query(
    `DELETE FROM whatsapp_mensagens
     WHERE arrecadacao_id = ?
       AND (tipo = 'reaction' OR (tipo = 'unknown' AND texto = '[Mensagem não suportada]'))`,
    [arrecadacaoId],
  );

  const reactionReconcile = await reconcileReactionRecords(pool, arrecadacaoId, records);
  const reactionBackfill = await backfillReactionsForLead(pool, arrecadacaoId, { days, maxReactions: 200 });

  const mediaMirrored = await backfillWhatsappMediaForLead(pool, arrecadacaoId, recordsByEvolutionId, {
    limit: mediaBackfillLimit,
  });

  return {
    imported,
    reactions: (reactionReconcile.applied || 0) + (reactionBackfill.applied || 0),
    reactionGhostsRemoved: reactionReconcile.cleaned || 0,
    reactionBackfill: reactionBackfill.applied || 0,
    mediaMirrored,
    total: records.length,
    remoteJid: remoteJids[0],
    remoteJids,
    days,
  };
}

export async function listWhatsappMessages(pool, arrecadacaoId, { limit = 200 } = {}) {
  const max = Math.min(Math.max(limit, 1), 500);
  const [rows] = await pool.query(
    `SELECT recent.id, recent.arrecadacao_id, recent.evolution_message_id, recent.remote_jid,
            recent.direcao, recent.tipo, recent.texto, recent.midia_url, recent.midia_mimetype,
            recent.midia_storage_path, recent.enviado_em, recent.criado_em
     FROM (
       SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto,
              midia_url, midia_mimetype, midia_storage_path, enviado_em, criado_em
       FROM whatsapp_mensagens
       WHERE arrecadacao_id = ?
         AND tipo <> 'reaction'
         AND NOT (tipo = 'unknown' AND texto = '[Mensagem não suportada]')
       ORDER BY enviado_em DESC, id DESC
       LIMIT ?
     ) recent
     ORDER BY recent.enviado_em ASC, recent.id ASC`,
    [arrecadacaoId, max],
  );
  const mensagens = rows.map((row) => rowToMensagem(row));
  return attachReactionsToMensagens(pool, mensagens);
}

async function loadMensagemForReaction(pool, mensagemId, { arrecadacaoId, eventoId, participanteId } = {}) {
  const params = [mensagemId];
  let sql = `
    SELECT wm.id, wm.arrecadacao_id, wm.evolution_message_id, wm.remote_jid, wm.direcao
    FROM whatsapp_mensagens wm
    JOIN arrecadacao a ON a.id = wm.arrecadacao_id
    WHERE wm.id = ?`;

  if (arrecadacaoId) {
    sql += ' AND wm.arrecadacao_id = ?';
    params.push(arrecadacaoId);
  }
  if (eventoId && participanteId) {
    sql += ' AND a.evento_id = ? AND a.participante_id = ?';
    params.push(eventoId, participanteId);
  }

  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

export async function reactToWhatsappMessage(
  pool,
  mensagemId,
  emoji,
  { arrecadacaoId, eventoId, participanteId } = {},
) {
  const row = await loadMensagemForReaction(pool, mensagemId, {
    arrecadacaoId,
    eventoId,
    participanteId,
  });
  if (!row) {
    throw Object.assign(new Error('Mensagem não encontrada'), { status: 404 });
  }
  if (!row.evolution_message_id || !row.remote_jid) {
    throw Object.assign(new Error('Mensagem sem identificador do WhatsApp'), { status: 400 });
  }

  const normalizedEmoji = normalizeEmoji(emoji);
  const myReaction = (await getReactionsForMensagem(pool, mensagemId)).find((r) => r.fromMe);
  const nextEmoji =
    normalizedEmoji && myReaction?.emoji === normalizedEmoji ? '' : normalizedEmoji;

  await sendReactionMessage(
    {
      id: row.evolution_message_id,
      remoteJid: row.remote_jid,
      fromMe: row.direcao === 'out',
    },
    nextEmoji,
  );

  await applyReaction(pool, mensagemId, { emoji: nextEmoji, autorKey: 'me', fromMe: true });

  const reacoes = await getReactionsForMensagem(pool, mensagemId);
  await emitWhatsappReaction(pool, row.arrecadacao_id, {
    mensagemId: row.id,
    evolutionMessageId: row.evolution_message_id,
    reacoes,
  });

  return { mensagemId: row.id, evolutionMessageId: row.evolution_message_id, reacoes };
}

export async function sendWhatsappToLead(pool, arrecadacaoId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('Informe a mensagem'), { status: 400 });
  }

  const phone = await getLeadPhone(pool, arrecadacaoId);
  if (!phone) {
    throw Object.assign(new Error('Lead sem WhatsApp cadastrado'), { status: 400 });
  }

  const response = await sendTextMessage(phone, trimmed);
  const remoteJid = remoteJidFromPhone(phone);

  const key = response?.key || response?.message?.key || {};
  const evolutionMessageId = String(key.id || `local-${Date.now()}`);
  const enviadoEm = messageTimestampToDate(
    response?.messageTimestamp || response?.message?.messageTimestamp || Date.now() / 1000,
  );

  const saved = await insertWhatsappMessage(pool, arrecadacaoId, {
    evolutionMessageId,
    remoteJid: key.remoteJid || remoteJid,
    direcao: 'out',
    tipo: 'text',
    texto: trimmed,
    midiaUrl: null,
    midiaMimetype: null,
    enviadoEm,
  });

  await emitWhatsappMessage(pool, arrecadacaoId, saved);

  return { mensagem: saved, evolution: response };
}

export async function getWhatsappStatus() {
  const config = getEvolutionConfig();
  if (!config.enabled) {
    return { configured: false, connected: false, instance: config.instance, state: 'not_configured' };
  }

  try {
    const state = await getConnectionState();
    const connection = parseConnectionState(state);
    return {
      configured: true,
      connected: isConnectedState(connection),
      instance: config.instance,
      state: connection || 'unknown',
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      instance: config.instance,
      state: 'error',
      error: err.message,
    };
  }
}

export async function getWhatsappStatusQuick(timeoutMs = 8000) {
  const config = getEvolutionConfig();
  if (!config.enabled) {
    return { configured: false, connected: false, instance: config.instance, state: 'not_configured' };
  }

  try {
    return await Promise.race([
      getWhatsappStatus(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } catch (err) {
    return {
      configured: true,
      connected: false,
      instance: config.instance,
      state: 'timeout',
      error: err.message === 'timeout' ? 'Evolution API demorou para responder' : err.message,
    };
  }
}

async function maybeConfigureWebhook() {
  const publicUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  if (!publicUrl) return;
  const webhookUrl = `${publicUrl}/api/webhooks/evolution`;
  try {
    await configureInstanceWebhook(webhookUrl, process.env.EVOLUTION_WEBHOOK_SECRET || '');
  } catch (err) {
    const detail = err.body ? JSON.stringify(err.body) : err.message;
    console.warn('Não foi possível configurar webhook Evolution:', detail);
  }
}

export async function connectWhatsapp({ phone } = {}) {
  const config = getEvolutionConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Evolution API não configurada no servidor'), { status: 503 });
  }

  await ensureInstance();
  let stateRes = await getConnectionState();
  let connection = parseConnectionState(stateRes);

  if (isConnectedState(connection)) {
    await maybeConfigureWebhook();
    return {
      configured: true,
      connected: true,
      instance: config.instance,
      state: connection,
      qrcode: null,
    };
  }

  const connectRes = await connectInstance(phone);
  const qrcode = extractQrPayload(connectRes);
  stateRes = await getConnectionState();
  connection = parseConnectionState(stateRes);

  await maybeConfigureWebhook();

  return {
    configured: true,
    connected: isConnectedState(connection),
    instance: config.instance,
    state: connection || 'connecting',
    qrcode,
  };
}

export async function disconnectWhatsapp() {
  const config = getEvolutionConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Evolution API não configurada no servidor'), { status: 503 });
  }

  await logoutInstance();
  return getWhatsappStatus();
}

export function validateWebhookSecret(req) {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  if (!expected) return true;
  const header = req.headers['x-webhook-secret'];
  const query = req.query?.secret;
  return header === expected || query === expected;
}
