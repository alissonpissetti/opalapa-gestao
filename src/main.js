import { fetchSession, logout } from './lib/auth.js';
import { setUnauthorizedHandler, fetchEventos, fetchParticipantes, fetchArrecadacaoByEspacoId } from './lib/api.js';
import { initEventoContext, onEventoChange } from './lib/evento.js';
import { createSpacesStore } from './lib/store.js';
import { canAccessView, canAccessWhatsapp, canManageWhatsappConnection } from './lib/permissions.js';
import { initSpacesModule } from './modules/spaces.js';
import { initLoginScreen } from './modules/login.js';
import { initNavigation } from './modules/navigation.js';
import { initUsersModule } from './modules/users.js';
import { initArrecadacaoModule } from './modules/arrecadacao.js';
import { initTarefasModule } from './modules/tarefas.js';
import { initTarefaEditor } from './modules/tarefa-editor.js';
import { initEventosModule, initEventoSelector } from './modules/eventos.js';
import { initMarketingModule } from './modules/marketing.js';
import { initProducaoCronologiaModule } from './modules/producao-cronologia.js';
import { initProducaoPremiacoesModule } from './modules/producao-premiacoes.js';
import { initFinanceiroGestaoModule } from './modules/financeiro-gestao.js';
import { initContasPagarModule } from './modules/contas-pagar.js';
import { initPermissoesModule } from './modules/permissoes.js';
import { initWhatsappConnect } from './modules/whatsapp-connect.js';
import { initWhatsappInbox } from './modules/whatsapp-inbox.js';
import { initParticipantesModule } from './modules/participantes.js';

const loadingEl = document.getElementById('app-loading');
const appScreen = document.getElementById('app-screen');
const userNameEl = document.getElementById('user-name');
let spacesModule = null;
let arrecadacaoModule = null;
let participantesModule = null;
let whatsappInboxModule = null;
let tarefasModule = null;
let marketingModule = null;
let cronologiaModule = null;
let premiacoesModule = null;
let financeiroGestaoModule = null;
let contasPagarModule = null;
let permissoesModule = null;
let usersModule = null;
let eventosModule = null;
let eventoSelector = null;
let navigation = null;
let store = null;

async function openLeadFromApp(arrecadacaoId, { tipo } = {}) {
  if (!arrecadacaoId || !arrecadacaoModule) return false;
  const view = tipo === 'artistico' ? 'artistico' : 'arrecadacao';
  if (canAccessView(view)) {
    navigation?.navigate(view);
  }
  return arrecadacaoModule.openLeadDetail(arrecadacaoId, { tipo });
}

function syncAppHeaderHeight() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
}

function showApp(user) {
  userNameEl.textContent = user.name;
  appScreen.classList.remove('hidden');
  loginScreen.hide();
  requestAnimationFrame(syncAppHeaderHeight);
}

function showLoginOnly() {
  appScreen.classList.add('hidden');
  spacesModule = null;
  arrecadacaoModule = null;
  tarefasModule = null;
  marketingModule = null;
  cronologiaModule = null;
  premiacoesModule = null;
  financeiroGestaoModule = null;
  contasPagarModule = null;
  permissoesModule = null;
  usersModule = null;
  eventosModule = null;
  eventoSelector = null;
  navigation = null;
  store = null;
  loginScreen.show();
}

async function syncParticipantesList() {
  try {
    const { participantes } = await fetchParticipantes();
    store?.setParticipantes(participantes || []);
    spacesModule?.renderParticipantesDatalist?.();
  } catch (_) {
    spacesModule?.renderParticipantesDatalist?.();
  }
}

async function reloadEspacosFromServer() {
  if (!canAccessView('espacos') || !store?.currentGrupo?.slug) return;
  await store.loadGrupo(store.currentGrupo.slug);
  spacesModule?.renderGrupoTabs();
  await spacesModule?.reloadFunilEtapas?.();
  spacesModule?.renderAll();
  spacesModule?.updateSyncStatus();
}

async function loadEspacosStore() {
  if (!store || !canAccessView('espacos')) return;
  if (store.ready) return;
  await store.load();
}

async function reloadEventoData() {
  if (!store) return;
  if (canAccessView('espacos')) {
    await loadEspacosStore();
  }
  spacesModule?.renderGrupoTabs();
  await spacesModule?.reloadFunilEtapas?.();
  spacesModule?.renderAll();
  spacesModule?.updateSyncStatus();
  await syncParticipantesList();
  const arrView = navigation?.getCurrentView();
  if (arrView === 'artistico') {
    await arrecadacaoModule?.setLeadScope('artistico');
  } else if (arrView === 'arrecadacao') {
    await arrecadacaoModule?.setLeadScope('comercial');
  }
  if (navigation?.getCurrentView() === 'tarefas') {
    tarefasModule?.loadTarefas();
  }
  if (navigation?.getCurrentView() === 'marketing') {
    marketingModule?.loadMarketing();
  }
  if (navigation?.getCurrentView() === 'cronologia') {
    cronologiaModule?.loadCronologia();
  }
  if (navigation?.getCurrentView() === 'premiacoes') {
    premiacoesModule?.loadPremiacoes();
  }
  if (navigation?.getCurrentView() === 'financeiro-gestao') {
    financeiroGestaoModule?.loadFinanceiroGestao();
  }
  if (navigation?.getCurrentView() === 'financeiro-contas-pagar') {
    contasPagarModule?.loadContasPagar();
  }
  if (navigation?.getCurrentView() === 'permissoes') {
    permissoesModule?.loadPermissoes();
  }
}

async function refreshEventoList() {
  const { eventos } = await fetchEventos();
  initEventoContext(eventos);
  await eventoSelector?.refresh(eventos);
  await reloadEventoData();
}

async function initApp(user) {
  const { eventos } = await fetchEventos();
  initEventoContext(eventos);

  store = createSpacesStore();
  const spaceShortcuts = {};

  if (canAccessView('espacos')) {
    await loadEspacosStore();
    spacesModule = initSpacesModule(store, spaceShortcuts);
    spacesModule.renderGrupoTabs();
    spacesModule.renderAll();
    spacesModule.updateSyncStatus();
  }

  participantesModule = initParticipantesModule(store, {
    onSaved: () => {
      void syncParticipantesList();
      spacesModule?.renderParticipantesDatalist?.();
    },
    onOpenWhatsappChat: (participanteId) => whatsappInboxModule?.openThread(participanteId),
  });

  const tarefaEditor = initTarefaEditor({
    onSaved: async () => {
      await tarefasModule?.loadTarefas();
      await arrecadacaoModule?.refreshLeadTarefas?.();
    },
  });

  arrecadacaoModule = initArrecadacaoModule(store, {
    onTarefaChanged: () => tarefasModule?.loadTarefas(),
    onNavigate: (view) => navigation?.navigate(view),
    openTarefaEditor: (tarefa, opts) => tarefaEditor.open(tarefa, opts),
    onEspacosDataChanged: () => reloadEspacosFromServer(),
    onOpenEspaco: async ({ numero, grupoSlug }) => {
      navigation?.navigate('espacos');
      if (grupoSlug && store?.currentGrupo?.slug !== grupoSlug) {
        await store.switchGrupo(grupoSlug);
        spacesModule?.renderGrupoTabs();
        await spacesModule?.reloadFunilEtapas?.();
        spacesModule?.renderAll();
      }
      if (numero) spacesModule?.openSpace?.(numero);
    },
    currentUser: user,
    onOpenWhatsappChat: (participanteId) => whatsappInboxModule?.openThread(participanteId),
  });
  tarefasModule = initTarefasModule({
    openTarefaEditor: (tarefa, opts) => tarefaEditor.open(tarefa, opts),
    onOpenWhatsappChat: (participanteId) => whatsappInboxModule?.openThread(participanteId),
    onOpenLead: (arrecadacaoId, opts) => openLeadFromApp(arrecadacaoId, opts),
  });
  await syncParticipantesList();
  marketingModule = initMarketingModule();
  cronologiaModule = initProducaoCronologiaModule({
    onOpenWhatsappChat: (participanteId) => whatsappInboxModule?.openThread(participanteId),
    onSaved: () => syncParticipantesList(),
  });
  premiacoesModule = initProducaoPremiacoesModule({
    onOpenWhatsappChat: (participanteId) => whatsappInboxModule?.openThread(participanteId),
    onSaved: () => syncParticipantesList(),
  });
  financeiroGestaoModule = initFinanceiroGestaoModule();
  contasPagarModule = initContasPagarModule();
  permissoesModule = initPermissoesModule();
  usersModule = initUsersModule(user);

  eventoSelector = initEventoSelector({ onChange: reloadEventoData });
  await eventoSelector.refresh(eventos);

  eventosModule = initEventosModule({ onEventosChanged: refreshEventoList });

  onEventoChange(() => reloadEventoData());

  navigation = initNavigation({
    onViewChange(view) {
      if (view === 'eventos') eventosModule.loadEventos();
      if (view === 'espacos') {
        void loadEspacosStore().then(() => {
          spacesModule?.renderGrupoTabs();
          return spacesModule?.reloadFunilEtapas?.();
        }).then(() => {
          spacesModule?.renderAll();
          spacesModule?.updateSyncStatus();
        });
      }
      if (view === 'arrecadacao') arrecadacaoModule.setLeadScope('comercial');
      if (view === 'artistico') arrecadacaoModule.setLeadScope('artistico');
      if (view === 'tarefas') tarefasModule.loadTarefas();
      if (view === 'marketing') marketingModule.loadMarketing();
      if (view === 'cronologia') cronologiaModule.loadCronologia();
      if (view === 'premiacoes') premiacoesModule.loadPremiacoes();
      if (view === 'financeiro-gestao') financeiroGestaoModule.loadFinanceiroGestao();
      if (view === 'financeiro-contas-pagar') contasPagarModule.loadContasPagar();
      if (view === 'permissoes') permissoesModule.loadPermissoes();
      if (view === 'usuarios') usersModule.loadUsers();
    },
  });

  if (canManageWhatsappConnection()) {
    initWhatsappConnect();
  }
  if (canAccessWhatsapp()) {
    whatsappInboxModule = initWhatsappInbox({
      onOpenLead: (arrecadacaoId, opts) => openLeadFromApp(arrecadacaoId, opts),
    });
  }

  spaceShortcuts.onOpenParticipante = (participanteId) => {
    participantesModule?.openParticipante(participanteId);
  };
  spaceShortcuts.onOpenWhatsapp = async (participanteId) => {
    await whatsappInboxModule?.openThread(participanteId);
  };
  spaceShortcuts.onOpenLead = async (payload) => {
    let arrecadacaoId =
      typeof payload === 'number' ? payload : Number(payload?.arrecadacaoId) || null;
    if (!arrecadacaoId && payload?.espacoId) {
      try {
        const data = await fetchArrecadacaoByEspacoId(payload.espacoId);
        arrecadacaoId = data?.item?.id || null;
      } catch (_) {
        arrecadacaoId = null;
      }
    }
    if (!arrecadacaoId) {
      alert('Lead não encontrado para este espaço. Salve o espaço e tente novamente.');
      return;
    }
    const opened = await openLeadFromApp(arrecadacaoId, { tipo: 'espaco' });
    if (!opened) {
      alert('Lead não encontrado para este espaço. Salve o espaço e tente novamente.');
    }
  };
}

const loginScreen = initLoginScreen(async (user) => {
  try {
    await initApp(user);
    showApp(user);
  } catch (err) {
    await logout();
    loginScreen.showError(`Falha ao carregar dados: ${err.message}`);
    loginScreen.show();
  }
});

async function handleLogout() {
  await logout();
  showLoginOnly();
}

document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
document.getElementById('btn-logout-drawer')?.addEventListener('click', handleLogout);

setUnauthorizedHandler(() => {
  showLoginOnly();
});

async function boot() {
  try {
    const user = await fetchSession();
    if (!user) {
      showLoginOnly();
      return;
    }

    await initApp(user);
    showApp(user);
  } catch (err) {
    if (loadingEl) {
      loadingEl.textContent = `Falha ao conectar: ${err.message}`;
      loadingEl.classList.add('error');
    } else {
      console.error(err);
      alert(`Falha ao carregar o sistema: ${err.message}`);
    }
    return;
  } finally {
    if (!loadingEl?.classList.contains('error')) {
      loadingEl?.remove();
    }
  }
}

boot();

window.addEventListener('resize', syncAppHeaderHeight);
