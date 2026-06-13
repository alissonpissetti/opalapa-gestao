import {
  nationalPhoneDigits,
  phoneFromRemoteJid,
  phoneSearchVariants,
  remoteJidFromPhone,
  isGroupJid,
} from './whatsapp-phone.js';
import {
  findChatMessages,
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
} from './evolution.js';

function rowToMensagem(row) {
  return {
    id: row.id,
    arrecadacaoId: Number(row.arrecadacao_id),
    evolutionMessageId: row.evolution_message_id,
    remoteJid: row.remote_jid,
    direcao: row.direcao,
    tipo: row.tipo,
    texto: row.texto || '',
    midiaUrl: row.midia_url || null,
    midiaMimetype: row.midia_mimetype || null,
    enviadoEm: row.enviado_em ? new Date(row.enviado_em).toISOString() : null,
    criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : null,
  };
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

  return { tipo: 'unknown', texto: '[Mensagem não suportada]', midiaUrl: null, midiaMimetype: null };
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
  if (event && !event.includes('message') && event !== 'send.message') return [];

  let data = payload.data ?? payload;
  if (data?.messages) data = data.messages;
  if (data?.records) data = data.records;
  if (!Array.isArray(data)) data = [data];

  return data.filter((item) => item && item.key && item.key.remoteJid);
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
      enviado_em DATETIME(3) NOT NULL,
      criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_wa_msg_lead (arrecadacao_id, evolution_message_id),
      INDEX idx_wa_lead_time (arrecadacao_id, enviado_em),
      CONSTRAINT fk_wa_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
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
            midia_url, midia_mimetype, enviado_em, criado_em
     FROM whatsapp_mensagens
     WHERE arrecadacao_id = ? AND evolution_message_id = ?
     LIMIT 1`,
    [arrecadacaoId, evolutionMessageId],
  );
  return rows[0] ? rowToMensagem(rows[0]) : null;
}

export async function persistEvolutionMessage(pool, rawMessage, { arrecadacaoIds } = {}) {
  const key = rawMessage.key || {};
  const remoteJid = String(key.remoteJid || '');
  if (!remoteJid || isGroupJid(remoteJid)) return { saved: 0 };

  const phone = phoneFromRemoteJid(remoteJid);
  const leadIds =
    arrecadacaoIds?.length > 0 ? arrecadacaoIds : await findArrecadacaoIdsByPhone(pool, phone);
  if (!leadIds.length) return { saved: 0, phone };

  const content = extractMessageContent(rawMessage.message);
  const evolutionMessageId = String(key.id || '');
  if (!evolutionMessageId) return { saved: 0 };

  const enviadoEm = messageTimestampToDate(rawMessage.messageTimestamp);
  const direcao = key.fromMe ? 'out' : 'in';

  let saved = 0;
  for (const arrecadacaoId of leadIds) {
    const row = await insertWhatsappMessage(pool, arrecadacaoId, {
      evolutionMessageId,
      remoteJid,
      direcao,
      tipo: content.tipo,
      texto: content.texto,
      midiaUrl: content.midiaUrl,
      midiaMimetype: content.midiaMimetype,
      enviadoEm,
    });
    if (row) saved += 1;
  }

  return { saved, phone, leadIds };
}

export async function handleEvolutionWebhook(pool, payload) {
  const messages = normalizeWebhookMessages(payload);
  let saved = 0;
  for (const msg of messages) {
    const result = await persistEvolutionMessage(pool, msg);
    saved += result.saved || 0;
  }
  return { ok: true, saved, count: messages.length };
}

function collectFindMessagesRecords(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.messages?.records)) return body.messages.records;
  if (Array.isArray(body.records)) return body.records;
  if (Array.isArray(body.data)) return body.data;
  if (body.data?.messages?.records) return body.data.messages.records;
  return [];
}

export async function syncWhatsappHistory(pool, arrecadacaoId, { limit = 80 } = {}) {
  const phone = await getLeadPhone(pool, arrecadacaoId);
  if (!phone) {
    throw Object.assign(new Error('Lead sem WhatsApp cadastrado'), { status: 400 });
  }

  const remoteJid = remoteJidFromPhone(phone);
  if (!remoteJid) {
    throw Object.assign(new Error('WhatsApp inválido no cadastro do lead'), { status: 400 });
  }

  const response = await findChatMessages(remoteJid, { page: 1, offset: limit });
  const records = collectFindMessagesRecords(response);

  let imported = 0;
  for (const record of records) {
    const result = await persistEvolutionMessage(pool, record, {
      arrecadacaoIds: [arrecadacaoId],
    });
    imported += result.saved || 0;
  }

  return { imported, total: records.length, remoteJid };
}

export async function listWhatsappMessages(pool, arrecadacaoId, { limit = 200 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, arrecadacao_id, evolution_message_id, remote_jid, direcao, tipo, texto,
            midia_url, midia_mimetype, enviado_em, criado_em
     FROM whatsapp_mensagens
     WHERE arrecadacao_id = ?
     ORDER BY enviado_em ASC, id ASC
     LIMIT ?`,
    [arrecadacaoId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map(rowToMensagem);
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

async function maybeConfigureWebhook() {
  const publicUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  if (!publicUrl) return;
  const webhookUrl = `${publicUrl}/api/webhooks/evolution`;
  try {
    await configureInstanceWebhook(webhookUrl, process.env.EVOLUTION_WEBHOOK_SECRET || '');
  } catch (err) {
    console.warn('Não foi possível configurar webhook Evolution:', err.message);
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
