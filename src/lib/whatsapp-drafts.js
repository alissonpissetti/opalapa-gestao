import { getActiveEventoId } from './evento.js';

const PREFIX = 'opalapa-wa-draft';

function storageKey(participanteId) {
  const eventoId = getActiveEventoId();
  const pid = Number(participanteId);
  if (!eventoId || !Number.isInteger(pid) || pid < 1) return null;
  return `${PREFIX}:${eventoId}:${pid}`;
}

export function readWhatsappDraft(participanteId) {
  try {
    const key = storageKey(participanteId);
    if (!key) return '';
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function writeWhatsappDraft(participanteId, text) {
  try {
    const key = storageKey(participanteId);
    if (!key) return;
    const value = String(text ?? '');
    if (!value.trim()) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    /* quota ou modo privado */
  }
}

export function clearWhatsappDraft(participanteId) {
  try {
    const key = storageKey(participanteId);
    if (key) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
