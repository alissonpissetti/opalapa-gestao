const VIEW_ORDER = [
  'espacos',
  'eventos',
  'arrecadacao',
  'arrecadacao-planos',
  'artistico',
  'tarefas',
  'marketing',
  'cronologia',
  'premiacoes',
  'entregas',
  'financeiro-gestao',
  'financeiro-contas-pagar',
  'financeiro-plano-contas',
  'usuarios',
  'permissoes',
];

/** Espelha server/permissions.js — módulos que usam conversas com participantes. */
export const WHATSAPP_VIEWS = [
  'espacos',
  'arrecadacao',
  'artistico',
  'tarefas',
  'marketing',
  'cronologia',
  'premiacoes',
  'financeiro-gestao',
];

let permissions = [];
let isAdmin = false;

export function setUserPermissions(user) {
  permissions = Array.isArray(user?.permissions) ? [...user.permissions] : [];
  isAdmin = Boolean(user?.isAdmin);
}

export function getUserPermissions() {
  return [...permissions];
}

/** Views que herdam permissão de outra tela (sem entrada própria no catálogo). */
const VIEW_PERMISSION_ALIASES = {
  'arrecadacao-planos': 'arrecadacao',
};

export function canAccessView(view) {
  if (isAdmin) return true;
  const key = VIEW_PERMISSION_ALIASES[view] || view;
  return permissions.includes(key);
}

export function canAccessWhatsapp() {
  if (isAdmin) return true;
  return WHATSAPP_VIEWS.some((view) => permissions.includes(view));
}

export function canManageWhatsappConnection() {
  return isAdmin;
}

export function getDefaultView() {
  return VIEW_ORDER.find((view) => canAccessView(view)) || null;
}

export function applyNavPermissions() {
  document.querySelectorAll('[data-view]').forEach((el) => {
    const view = el.dataset.view;
    const allowed = canAccessView(view);
    el.classList.toggle('nav-hidden', !allowed);
    el.setAttribute('aria-hidden', allowed ? 'false' : 'true');
  });

  document.querySelectorAll('.nav-dropdown').forEach((dropdown) => {
    const links = dropdown.querySelectorAll('.nav-link[data-view]');
    const visibleLinks = [...links].filter((link) => !link.classList.contains('nav-hidden'));
    dropdown.classList.toggle('nav-hidden', visibleLinks.length === 0);
  });

  applyWhatsappHeaderPermissions();
}

export function applyWhatsappHeaderPermissions() {
  const inboxBtn = document.getElementById('btn-whatsapp-inbox');
  const connectBtn = document.getElementById('btn-whatsapp-connect');
  const inboxAllowed = canAccessWhatsapp();
  const connectAllowed = canManageWhatsappConnection();

  if (inboxBtn) {
    inboxBtn.classList.toggle('nav-hidden', !inboxAllowed);
    inboxBtn.setAttribute('aria-hidden', inboxAllowed ? 'false' : 'true');
  }
  if (connectBtn) {
    connectBtn.classList.toggle('nav-hidden', !connectAllowed);
    connectBtn.setAttribute('aria-hidden', connectAllowed ? 'false' : 'true');
  }
}

export function groupCatalogByArea(catalog = []) {
  const areas = new Map();
  for (const item of catalog) {
    if (!areas.has(item.area)) areas.set(item.area, []);
    areas.get(item.area).push(item);
  }
  return [...areas.entries()].map(([area, items]) => ({ area, items }));
}
