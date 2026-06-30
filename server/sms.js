import { normalizeBrCellphone, toComteleReceivers } from './lib/phone-br.js';

/**
 * Envio SMS via Comtele — POST /api/v2/send
 * @see https://docs.comtele.com.br/
 * Referência: condo-workspace/condo-api/src/plugins/comtele/comtele.service.ts
 */

function getComteleConfig() {
  const rawSender = process.env.COMTELE_SENDER_ID?.trim() ?? '66912';
  const senderId = Number(rawSender);
  return {
    baseUrl: process.env.COMTELE_API_BASE_URL?.trim() || 'https://sms.comtele.com.br',
    authKey: process.env.COMTELE_AUTH_KEY?.trim() || '',
    senderId: Number.isFinite(senderId) ? senderId : 66912,
  };
}

export function isSmsConfigured() {
  return !!getComteleConfig().authKey;
}

export function shouldEchoDevCode() {
  return (
    process.env.NODE_ENV !== 'production' &&
    String(process.env.DEV_SMS_ECHO || 'true').toLowerCase() !== 'false'
  );
}

async function sendViaComtele(phone, content) {
  const { baseUrl, authKey, senderId } = getComteleConfig();
  if (!authKey) {
    throw Object.assign(new Error('Envio de SMS não configurado (COMTELE_AUTH_KEY).'), {
      status: 503,
    });
  }

  const normalized = normalizeBrCellphone(phone);
  if (!normalized) {
    throw Object.assign(new Error('Telefone inválido para SMS'), { status: 400 });
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/send`;
  const body = {
    Sender: senderId,
    Receivers: toComteleReceivers(normalized),
    Content: content,
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        'auth-key': authKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('Comtele: falha de rede ao enviar SMS', err);
    throw Object.assign(new Error('Não foi possível contatar o serviço de SMS.'), { status: 502 });
  }

  const text = await response.text().catch(() => '');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const apiMessage = parsed?.Message?.trim();

  if (response.ok && parsed && parsed.Success === false) {
    console.error(`Comtele Success=false: ${apiMessage ?? text}`);
    throw Object.assign(new Error(apiMessage || 'O serviço de SMS recusou o envio.'), {
      status: 502,
    });
  }

  if (!response.ok) {
    console.error(`Comtele HTTP ${response.status}: ${text}`);
    throw Object.assign(
      new Error(apiMessage || `O serviço de SMS recusou o envio (HTTP ${response.status}).`),
      { status: 502 },
    );
  }

  return { ok: true, mode: 'comtele' };
}

export async function sendSms(phone, message) {
  if (isSmsConfigured()) {
    return sendViaComtele(phone, message);
  }

  if (shouldEchoDevCode()) {
    const normalized = normalizeBrCellphone(phone);
    console.log(
      `[SMS/dev] Sem COMTELE_AUTH_KEY — Para ${normalized || phone}: ${message}`,
    );
    return { ok: true, mode: 'console' };
  }

  throw Object.assign(new Error('Envio de SMS não configurado (COMTELE_AUTH_KEY).'), {
    status: 503,
  });
}
