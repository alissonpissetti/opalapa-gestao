export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Telefone nacional BR (10–11 dígitos), sem código do país. */
export function nationalPhoneDigits(value) {
  let d = digitsOnly(value);
  if (d.startsWith('55') && d.length > 11) {
    d = d.slice(2);
  }
  return d.slice(0, 11);
}

/** Número para API Evolution (com DDI 55). */
export function toWhatsAppNumber(value) {
  const raw = digitsOnly(value);
  if (!raw) return '';
  if (raw.startsWith('55') && raw.length >= 12) return raw;
  const national = nationalPhoneDigits(value);
  if (!national) return '';
  if (national.length === 10 || national.length === 11) return `55${national}`;
  return raw;
}

export function phoneSearchVariants(value) {
  const national = nationalPhoneDigits(value);
  if (!national) return [];

  const variants = new Set([national]);
  if (national.length === 11 && national[2] === '9') {
    variants.add(national.slice(0, 2) + national.slice(3));
  }
  if (national.length === 10) {
    variants.add(`${national.slice(0, 2)}9${national.slice(2)}`);
  }
  for (const v of [...variants]) {
    variants.add(`55${v}`);
  }
  return [...variants];
}

export function remoteJidFromPhone(value) {
  const num = toWhatsAppNumber(value);
  return num ? `${num}@s.whatsapp.net` : '';
}

/** JIDs @s.whatsapp.net para buscar histórico (variantes BR com/sem 9º dígito). */
export function remoteJidVariantsFromPhone(value) {
  const jids = new Set();
  for (const variant of phoneSearchVariants(value)) {
    const jid = remoteJidFromPhone(variant);
    if (jid) jids.add(jid);
  }
  return [...jids];
}

export function phonesEquivalent(a, b) {
  const left = new Set(
    phoneSearchVariants(a)
      .map((v) => toWhatsAppNumber(v) || digitsOnly(v))
      .filter(Boolean),
  );
  const right = new Set(
    phoneSearchVariants(b)
      .map((v) => toWhatsAppNumber(v) || digitsOnly(v))
      .filter(Boolean),
  );
  for (const l of left) {
    if (right.has(l)) return true;
    for (const r of right) {
      if (l.length >= 10 && r.length >= 10 && (l.endsWith(r) || r.endsWith(l))) return true;
    }
  }
  return false;
}

export function phoneFromRemoteJid(jid) {
  const base = String(jid || '').split('@')[0];
  return digitsOnly(base);
}

export function isGroupJid(jid) {
  return String(jid || '').includes('@g.us');
}

export function isLidJid(jid) {
  return String(jid || '').includes('@lid');
}

/** JID do chat (telefone @s.whatsapp.net), ignorando @lid quando houver alternativa. */
export function resolveChatRemoteJid(record) {
  if (!record || typeof record !== 'object') return '';

  const key = record.key || {};
  const message = record.message && typeof record.message === 'object' ? record.message : {};
  const reactionKey = message.reactionMessage?.key || record.reactionMessage?.key || {};

  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    record.remoteJidAlt,
    record.participantAlt,
    reactionKey.remoteJidAlt,
    reactionKey.participantAlt,
    reactionKey.remoteJid,
    key.remoteJid,
    key.participant,
  ];

  for (const candidate of candidates) {
    const jid = String(candidate || '').trim();
    if (!jid || isLidJid(jid) || isGroupJid(jid)) continue;
    if (jid.includes('@s.whatsapp.net')) return jid;
  }

  for (const candidate of candidates) {
    const jid = String(candidate || '').trim();
    if (!jid || isLidJid(jid) || isGroupJid(jid)) continue;
    return jid;
  }

  return '';
}

export function chatJidMatchesPhone(chatJid, phone) {
  const jid = String(chatJid || '').trim();
  if (!jid) return false;
  for (const variant of remoteJidVariantsFromPhone(phone)) {
    if (variant === jid) return true;
  }
  return phonesEquivalent(phoneFromRemoteJid(jid), phone);
}
