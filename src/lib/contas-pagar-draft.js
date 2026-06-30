import { getActiveEventoId } from './evento.js';

const PREFIX = 'opalapa:contas-pagar:draft';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function draftStorageKey(eventoId = getActiveEventoId()) {
  if (!eventoId) return null;
  return `${PREFIX}:${eventoId}`;
}

function parseDraft(raw) {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object' || !draft.savedAt) return null;
    const age = Date.now() - new Date(draft.savedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

export function readContasPagarDraft(eventoId = getActiveEventoId()) {
  try {
    const key = draftStorageKey(eventoId);
    if (!key) return null;
    const draft = parseDraft(localStorage.getItem(key));
    if (!draft) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeContasPagarDraft(data, eventoId = getActiveEventoId()) {
  try {
    const key = draftStorageKey(eventoId);
    if (!key) return;
    const payload = {
      ...data,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota ou modo privado */
  }
}

export function clearContasPagarDraft(eventoId = getActiveEventoId()) {
  try {
    const key = draftStorageKey(eventoId);
    if (key) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
