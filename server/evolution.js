import {
  toWhatsAppNumber,
  remoteJidVariantsFromPhone,
  phonesEquivalent,
  phoneFromRemoteJid,
  isGroupJid,
} from './whatsapp-phone.js';

export function getEvolutionConfig() {
  const baseUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  const instance = process.env.EVOLUTION_INSTANCE || 'opalapa';
  return {
    baseUrl,
    apiKey,
    instance,
    enabled: Boolean(baseUrl && apiKey && instance),
  };
}

async function evoFetch(path, options = {}) {
  const { baseUrl, apiKey } = getEvolutionConfig();
  if (!baseUrl || !apiKey) {
    throw Object.assign(new Error('Evolution API não configurada no servidor'), { status: 503 });
  }

  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        ...(fetchOptions.headers || {}),
      },
    });

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const msg =
        (body && (body.message || body.error || body.response?.message)) ||
        (typeof body === 'string' ? body : '') ||
        `Evolution HTTP ${res.status}`;
      throw Object.assign(new Error(String(msg)), { status: res.status, body });
    }

    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Evolution API demorou para responder'), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInstances() {
  return evoFetch('/instance/fetchInstances', { method: 'GET' });
}

export function parseConnectionState(stateResponse) {
  return String(stateResponse?.instance?.state || stateResponse?.state || '').toLowerCase();
}

export function isConnectedState(state) {
  const s = String(state || '').toLowerCase();
  return s === 'open' || s === 'connected';
}

export async function findConfiguredInstance() {
  const { instance } = getEvolutionConfig();
  const list = await fetchInstances();
  if (!Array.isArray(list)) return null;
  return (
    list.find((item) => {
      const name = item?.instance?.instanceName || item?.instanceName || item?.name;
      return name === instance;
    }) || null
  );
}

export async function createInstance(instanceName) {
  return evoFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: false,
    }),
  });
}

export async function ensureInstance() {
  const { instance } = getEvolutionConfig();
  const existing = await findConfiguredInstance();
  if (existing) return existing;
  return createInstance(instance);
}

export async function connectInstance(number) {
  const { instance } = getEvolutionConfig();
  const qs = number ? `?number=${encodeURIComponent(number)}` : '';
  return evoFetch(`/instance/connect/${encodeURIComponent(instance)}${qs}`, { method: 'GET' });
}

export async function logoutInstance() {
  const { instance } = getEvolutionConfig();
  return evoFetch(`/instance/logout/${encodeURIComponent(instance)}`, { method: 'DELETE' });
}

export function extractQrPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const base64 = body.base64 || body.qrcode?.base64 || null;
  const pairingCode = body.pairingCode || body.qrcode?.pairingCode || null;
  const code = body.code || body.qrcode?.code || null;
  if (!base64 && !pairingCode && !code) return null;
  return { base64, pairingCode, code };
}

export async function getConnectionState() {
  const { instance } = getEvolutionConfig();
  try {
    return await evoFetch(`/instance/connectionState/${encodeURIComponent(instance)}`, {
      method: 'GET',
    });
  } catch (err) {
    if (err.status === 404) return { state: 'not_found' };
    throw err;
  }
}

export async function sendTextMessage(phone, text) {
  const { instance } = getEvolutionConfig();
  const number = toWhatsAppNumber(phone);
  if (!number) throw Object.assign(new Error('Telefone inválido'), { status: 400 });

  const payload = { number, text: String(text || '').trim() };
  return evoFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function sendReactionMessage(key, reaction) {
  const { instance } = getEvolutionConfig();
  if (!key?.id || !key?.remoteJid) {
    throw Object.assign(new Error('Mensagem alvo inválida para reação'), { status: 400 });
  }

  return evoFetch(`/message/sendReaction/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      key: {
        id: String(key.id),
        remoteJid: String(key.remoteJid),
        fromMe: Boolean(key.fromMe),
        ...(key.participant ? { participant: String(key.participant) } : {}),
      },
      reaction: String(reaction ?? ''),
    }),
  });
}

export async function getBase64FromMediaMessage(messageRecord, { convertToMp4 = false } = {}) {
  const { instance } = getEvolutionConfig();
  const message = buildEvoMediaMessage(messageRecord);
  if (!message?.key?.id || !message?.key?.remoteJid) {
    throw Object.assign(new Error('Mensagem de mídia sem key completa'), { status: 400 });
  }

  return evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      convertToMp4: Boolean(convertToMp4),
    }),
    timeoutMs: 45000,
  });
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

function buildEvoMediaMessage(messageRecord) {
  const key = messageRecord?.key || messageRecord?.message?.key;
  if (!key?.id) return null;

  let remoteJid = String(key.remoteJid || '');
  if (remoteJid.includes('@lid') && key.remoteJidAlt) {
    remoteJid = String(key.remoteJidAlt);
  }

  const payload = {
    key: {
      id: String(key.id),
      remoteJid,
      fromMe: Boolean(key.fromMe),
    },
  };

  if (key.participant) payload.key.participant = String(key.participant);
  if (key.participantAlt) payload.key.participantAlt = String(key.participantAlt);
  if (key.remoteJidAlt) payload.key.remoteJidAlt = String(key.remoteJidAlt);

  const innerMessage = parseMessagePayload(messageRecord?.message);
  if (innerMessage && !innerMessage.key) {
    payload.message = innerMessage;
  } else if (innerMessage?.message) {
    payload.message = innerMessage.message;
  }

  if (messageRecord?.messageTimestamp != null) {
    payload.messageTimestamp = messageRecord.messageTimestamp;
  }

  return payload;
}

export async function downloadMediaMessage(messageRecord, { convertToMp4 = false } = {}) {
  const { instance } = getEvolutionConfig();
  const message = buildEvoMediaMessage(messageRecord);
  if (!message?.key?.id) {
    throw Object.assign(new Error('Mensagem de mídia sem ID'), { status: 400 });
  }

  return evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      convertToMp4: Boolean(convertToMp4),
    }),
    timeoutMs: 45000,
  });
}

export async function findChatMessageByKey(remoteJid, messageId) {
  if (!remoteJid || !messageId) return null;
  const targetId = String(messageId);

  const { instance } = getEvolutionConfig();
  const response = await evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      where: {
        key: {
          remoteJid: String(remoteJid),
          id: targetId,
        },
      },
      page: 1,
      offset: 1,
    }),
    timeoutMs: 20000,
  });
  const direct = collectFindMessagesRecords(response);
  const directHit = direct.find((record) => String(record?.key?.id || record?.id) === targetId);
  if (directHit) return directHit;

  for (let page = 1; page <= 8; page += 1) {
    const batch = await findChatMessages(remoteJid, { page, offset: 100 });
    const records = collectFindMessagesRecords(batch);
    const found = records.find((record) => String(record?.key?.id || record?.id) === targetId);
    if (found) return found;
    if (records.length < 100) break;
  }

  return findChatMessageById(targetId);
}

export async function findChatMessageById(messageId) {
  if (!messageId) return null;
  const targetId = String(messageId);
  const { instance } = getEvolutionConfig();

  const response = await evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      where: {
        key: {
          id: targetId,
        },
      },
      page: 1,
      offset: 1,
    }),
    timeoutMs: 20000,
  });

  const records = collectFindMessagesRecords(response);
  return records.find((record) => String(record?.key?.id || record?.id) === targetId) || records[0] || null;
}

export async function findChatMessages(
  remoteJid,
  { page = 1, offset = 100, messageTimestampGte, messageTimestampLte } = {},
) {
  const { instance } = getEvolutionConfig();
  const key = { remoteJid };
  if (messageTimestampGte != null || messageTimestampLte != null) {
    key.messageTimestamp = {};
    if (messageTimestampGte != null) key.messageTimestamp.gte = String(messageTimestampGte);
    if (messageTimestampLte != null) key.messageTimestamp.lte = String(messageTimestampLte);
  }

  return evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ where: { key }, page, offset }),
  });
}

export async function findChats({ page = 1, offset = 200 } = {}) {
  const { instance } = getEvolutionConfig();
  return evoFetch(`/chat/findChats/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ page, offset }),
  });
}

export async function resolveRemoteJidsForPhone(phone) {
  const jids = new Set(remoteJidVariantsFromPhone(phone));

  try {
    const chats = await findChats({ offset: 500 });
    const list = Array.isArray(chats) ? chats : [];
    for (const chat of list) {
      const candidates = new Set(
        [chat.remoteJid, chat.lastMessage?.key?.remoteJid, chat.lastMessage?.key?.participantAlt].filter(
          Boolean,
        ),
      );
      for (const jid of candidates) {
        if (isGroupJid(jid)) continue;
        const digits = phoneFromRemoteJid(jid);
        if (digits && phonesEquivalent(phone, digits)) jids.add(jid);
      }
    }
  } catch (err) {
    console.warn('resolveRemoteJidsForPhone:', err.message);
  }

  return [...jids];
}

export async function findReactionMessages({
  page = 1,
  offset = 100,
  messageTimestampGte,
  messageTimestampLte,
} = {}) {
  const { instance } = getEvolutionConfig();
  const where = { messageType: 'reactionMessage' };
  if (messageTimestampGte != null || messageTimestampLte != null) {
    where.messageTimestamp = {};
    if (messageTimestampGte != null) {
      const ts = Number(messageTimestampGte);
      where.messageTimestamp.gte = new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
    }
    if (messageTimestampLte != null) {
      const ts = Number(messageTimestampLte);
      where.messageTimestamp.lte = new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
    }
  }

  return evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ where, page, offset }),
    timeoutMs: 30000,
  });
}

export async function fetchGlobalReactionMessagesSince({
  days = 14,
  pageSize = 100,
  maxPages = 40,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const gte = now - Math.max(1, days) * 24 * 3600;
  const all = [];
  const seen = new Set();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const response = await findReactionMessages({
      page,
      offset: pageSize,
      messageTimestampGte: gte,
      messageTimestampLte: now,
    });
    const records = collectFindMessagesRecords(response);
    const meta = response?.messages && typeof response.messages === 'object' ? response.messages : response;
    totalPages = Math.max(1, Number(meta?.pages) || 1);

    if (!records.length) break;

    for (const record of records) {
      const id = record?.key?.id || record?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(record);
    }

    if (records.length < pageSize) break;
    page += 1;
  }

  return all;
}

export async function fetchChatMessagesSince(remoteJid, { days = 5, pageSize = 100, maxPages = 15 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const gte = now - Math.max(1, days) * 24 * 3600;
  const all = [];
  const seen = new Set();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const response = await findChatMessages(remoteJid, {
      page,
      offset: pageSize,
      messageTimestampGte: gte,
      messageTimestampLte: now,
    });
    const records = collectFindMessagesRecords(response);
    const meta = response?.messages && typeof response.messages === 'object' ? response.messages : response;
    totalPages = Math.max(1, Number(meta?.pages) || 1);

    if (!records.length) break;

    for (const record of records) {
      const id = record?.key?.id || record?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(record);
    }

    if (records.length < pageSize) break;
    page += 1;
  }

  return all;
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

export async function configureInstanceWebhook(webhookUrl, secret) {
  const { instance } = getEvolutionConfig();
  if (!webhookUrl) return null;

  const webhook = {
    enabled: true,
    url: webhookUrl,
    byEvents: false,
    base64: true,
    events: ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE'],
  };

  if (secret) {
    webhook.headers = { 'x-webhook-secret': secret };
  }

  return evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ webhook }),
  });
}
