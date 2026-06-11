import './css/app.css';
import { fetchSession, logout } from './lib/auth.js';
import { setUnauthorizedHandler } from './lib/api.js';
import { createSpacesStore } from './lib/store.js';
import { initSpacesModule } from './modules/spaces.js';
import { initLoginScreen } from './modules/login.js';
import { initNavigation } from './modules/navigation.js';
import { initUsersModule } from './modules/users.js';
import { initParticipantesModule } from './modules/participantes.js';
import { initArrecadacaoModule } from './modules/arrecadacao.js';

const loadingEl = document.getElementById('app-loading');
const appScreen = document.getElementById('app-screen');
const userNameEl = document.getElementById('user-name');
let spacesModule = null;
let participantesModule = null;
let arrecadacaoModule = null;
let usersModule = null;
let navigation = null;

function showApp(user) {
  userNameEl.textContent = user.name;
  appScreen.classList.remove('hidden');
  loginScreen.hide();
}

function showLoginOnly() {
  appScreen.classList.add('hidden');
  spacesModule = null;
  participantesModule = null;
  arrecadacaoModule = null;
  usersModule = null;
  navigation = null;
  loginScreen.show();
}

async function initApp(user) {
  const store = createSpacesStore();
  await store.load();
  spacesModule = initSpacesModule(store);
  spacesModule.renderGrupoTabs();
  spacesModule.renderAll();
  spacesModule.updateSyncStatus();

  participantesModule = initParticipantesModule(store);
  arrecadacaoModule = initArrecadacaoModule(store);
  usersModule = initUsersModule(user);
  navigation = initNavigation({
    onViewChange(view) {
      if (view === 'participantes') {
        participantesModule.loadParticipantes().then(() => {
          spacesModule?.renderParticipantesDatalist?.();
        });
      }
      if (view === 'arrecadacao') arrecadacaoModule.loadArrecadacao();
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
