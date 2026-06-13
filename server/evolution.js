import { toWhatsAppNumber } from './whatsapp-phone.js';

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

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      ...(options.headers || {}),
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

export async function findChatMessages(remoteJid, { page = 1, offset = 80 } = {}) {
  const { instance } = getEvolutionConfig();
  return evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      where: { key: { remoteJid } },
      page,
      offset,
    }),
  });
}

export async function configureInstanceWebhook(webhookUrl, secret) {
  const { instance } = getEvolutionConfig();
  if (!webhookUrl) return null;

  return evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        headers: secret ? { 'x-webhook-secret': secret } : {},
        events: ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE'],
      },
    }),
  });
}
