import './css/app.css';
import { fetchSession, logout } from './lib/auth.js';
import { setUnauthorizedHandler, fetchEventos, fetchParticipantes } from './lib/api.js';
import { initEventoContext, onEventoChange } from './lib/evento.js';
import { createSpacesStore } from './lib/store.js';
import { initSpacesModule } from './modules/spaces.js';
import { initLoginScreen } from './modules/login.js';
import { initNavigation } from './modules/navigation.js';
import { initUsersModule } from './modules/users.js';
import { initArrecadacaoModule } from './modules/arrecadacao.js';
import { initTarefasModule } from './modules/tarefas.js';
import { initTarefaEditor } from './modules/tarefa-editor.js';
import { initEventosModule, initEventoSelector } from './modules/eventos.js';

const loadingEl = document.getElementById('app-loading');
const appScreen = document.getElementById('app-screen');
const userNameEl = document.getElementById('user-name');
let spacesModule = null;
let arrecadacaoModule = null;
let tarefasModule = null;
let usersModule = null;
let eventosModule = null;
let eventoSelector = null;
let navigation = null;
let store = null;

function showApp(user) {
  userNameEl.textContent = user.name;
  appScreen.classList.remove('hidden');
  loginScreen.hide();
}

function showLoginOnly() {
  appScreen.classList.add('hidden');
  spacesModule = null;
  arrecadacaoModule = null;
  tarefasModule = null;
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
  if (!store?.currentGrupo?.slug) return;
  await store.loadGrupo(store.currentGrupo.slug);
  spacesModule?.renderGrupoTabs();
  await spacesModule?.reloadFunilEtapas?.();
  spacesModule?.renderAll();
  spacesModule?.updateSyncStatus();
}

async function reloadEventoData() {
  if (!store) return;
  await store.load();
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
  await store.load();
  spacesModule = initSpacesModule(store);
  spacesModule.renderGrupoTabs();
  spacesModule.renderAll();
  spacesModule.updateSyncStatus();

  const tarefaEditor = initTarefaEditor({
    onSaved: async () => {
      await tarefasModule?.loadTarefas();
      await arrecadacaoModule?.refreshLeadTarefas?.();
    },
  });

  arrecadacaoModule = initArrecadacaoModule(store, {
    onTarefaChanged: () => tarefasModule?.loadTarefas(),
    onNavigate: (view) => navigation?.navigate(view),
    openTarefaEditor: (tarefa) => tarefaEditor.open(tarefa),
    onEspacosDataChanged: () => reloadEspacosFromServer(),
  });
  tarefasModule = initTarefasModule({
    openTarefaEditor: (tarefa) => tarefaEditor.open(tarefa),
    onOpenLead: async (arrecadacaoId, { tipo } = {}) => {
      const view = tipo === 'artistico' ? 'artistico' : 'arrecadacao';
      navigation?.navigate(view);
      await arrecadacaoModule.openLeadDetail(arrecadacaoId, { tipo });
    },
  });
  await syncParticipantesList();
  usersModule = initUsersModule(user);

  eventoSelector = initEventoSelector({ onChange: reloadEventoData });
  await eventoSelector.refresh(eventos);

  eventosModule = initEventosModule({ onEventosChanged: refreshEventoList });

  onEventoChange(() => reloadEventoData());

  navigation = initNavigation({
    onViewChange(view) {
      if (view === 'eventos') eventosModule.loadEventos();
      if (view === 'espacos') reloadEspacosFromServer();
      if (view === 'arrecadacao') arrecadacaoModule.setLeadScope('comercial');
      if (view === 'artistico') arrecadacaoModule.setLeadScope('artistico');
      if (view === 'tarefas') tarefasModule.loadTarefas();
      if (view === 'usuarios') usersModule.loadUsers();
    },
  });
}

const loginScreen = initLoginScreen(async (user) => {
  try {
    await initApp(user);
    showApp(user);
  } catch (err) {
    await logout();
    loginScreen.showError(`Falha ao carregar dados: ${err.message}`);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await logout();
  showLoginOnly();
});

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
    }
    return;
  } finally {
    loadingEl?.remove();
  }
}

boot();
