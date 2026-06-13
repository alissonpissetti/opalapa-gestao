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

export function phoneFromRemoteJid(jid) {
  const base = String(jid || '').split('@')[0];
  return digitsOnly(base);
}

export function isGroupJid(jid) {
  return String(jid || '').includes('@g.us');
}
