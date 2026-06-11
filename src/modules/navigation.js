const VIEWS = {
  espacos: { viewId: 'view-espacos', navId: 'nav-espacos' },
  participantes: { viewId: 'view-participantes', navId: 'nav-participantes' },
  arrecadacao: { viewId: 'view-arrecadacao', navId: 'nav-arrecadacao' },
  usuarios: { viewId: 'view-usuarios', navId: 'nav-usuarios', parentId: 'nav-acessos' },
};

export function initNavigation({ onViewChange }) {
  let currentView = 'espacos';
  const dropdown = document.getElementById('nav-acessos');
  const dropdownToggle = document.getElementById('nav-acessos-toggle');

  function setActiveNav(view) {
    document.querySelectorAll('.nav-link').forEach((el) => {
      const isActive = el.dataset.view === view;
      el.classList.toggle('active', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });

    if (VIEWS[view]?.parentId) {
      document.getElementById(VIEWS[view].parentId)?.classList.add('active');
    } else {
      dropdown?.classList.remove('active');
    }
  }

  function navigate(view, { replace = false } = {}) {
    if (!VIEWS[view]) return;
    currentView = view;

    Object.values(VIEWS).forEach(({ viewId }) => {
      document.getElementById(viewId)?.classList.add('hidden');
    });
    document.getElementById(VIEWS[view].viewId)?.classList.remove('hidden');

    setActiveNav(view);
    dropdown?.classList.remove('open');
    dropdownToggle?.setAttribute('aria-expanded', 'false');

    const hash = `#${view}`;
    if (replace) history.replaceState({ view }, '', hash);
    else history.pushState({ view }, '', hash);

    onViewChange?.(view);
  }

  document.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.view);
    });
  });

  dropdownToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown?.classList.contains('open');
    dropdown?.classList.toggle('open', open);
    dropdownToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', () => dropdown?.classList.remove('open'));

  window.addEventListener('popstate', (e) => {
    const view = e.state?.view || location.hash.replace('#', '') || 'espacos';
    if (VIEWS[view]) navigate(view, { replace: true });
  });

  const initial = location.hash.replace('#', '');
  navigate(VIEWS[initial] ? initial : 'espacos', { replace: true });

  return { navigate, getCurrentView: () => currentView };
}
