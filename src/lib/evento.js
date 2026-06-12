const STORAGE_KEY = 'opalapa-evento-ativo';

let activeEventoId = null;
let activeEvento = null;
const listeners = new Set();

export function getActiveEventoId() {
  return activeEventoId;
}

export function getActiveEvento() {
  return activeEvento;
}

export function initEventoContext(eventos) {
  const saved = sessionStorage.getItem(STORAGE_KEY);
  const match = eventos.find((e) => String(e.id) === saved);
  const picked = match || eventos[0];
  if (!picked) throw new Error('Nenhum evento configurado');
  setActiveEvento(picked, { silent: true });
  return picked;
}

export function setActiveEvento(evento, { silent = false } = {}) {
  activeEventoId = evento.id;
  activeEvento = evento;
  sessionStorage.setItem(STORAGE_KEY, String(evento.id));
  if (!silent) listeners.forEach((cb) => cb(evento));
}

export function onEventoChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
