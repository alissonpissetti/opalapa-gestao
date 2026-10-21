import { canAccessView, getDefaultView, applyNavPermissions } from '../lib/permissions.js';

const VIEWS = {
  eventos: { viewId: 'view-eventos', navId: 'nav-eventos' },
  espacos: { viewId: 'view-espacos', navId: 'nav-espacos' },
  arrecadacao: { viewId: 'view-arrecadacao', navId: 'nav-arrecadacao-lista', parentId: 'nav-comercial' },
  'arrecadacao-planos': {
    viewId: 'view-arrecadacao-planos',
    navId: 'nav-arrecadacao-planos',
    parentId: 'nav-comercial',
  },
  artistico: { viewId: 'view-artistico', navId: 'nav-artistico', parentId: 'nav-comercial' },
  alimentacao: { viewId: 'view-alimentacao', navId: 'nav-alimentacao', parentId: 'nav-comercial' },
  tarefas: { viewId: 'view-tarefas', navId: 'nav-tarefas', parentId: 'nav-comercial' },
  marketing: { viewId: 'view-marketing', navId: 'nav-marketing', parentId: 'nav-comercial' },
  cronologia: { viewId: 'view-cronologia', navId: 'nav-cronologia', parentId: 'nav-producao' },
  premiacoes: { viewId: 'view-premiacoes', navId: 'nav-premiacoes', parentId: 'nav-producao' },
  entregas: { viewId: 'view-entregas', navId: 'nav-entregas', parentId: 'nav-producao' },
  materiais: { viewId: 'view-materiais', navId: 'nav-materiais', parentId: 'nav-producao' },
  'financeiro-gestao': {
    viewId: 'view-financeiro-gestao',
    navId: 'nav-financeiro-gestao',
    parentId: 'nav-financeiro',
  },
  'financeiro-contas-pagar': {
    viewId: 'view-financeiro-contas-pagar',
    navId: 'nav-financeiro-contas-pagar',
    parentId: 'nav-financeiro',
  },
  'financeiro-plano-contas': {
    viewId: 'view-financeiro-plano-contas',
    navId: 'nav-financeiro-plano-contas',
    parentId: 'nav-financeiro',
  },
  usuarios: { viewId: 'view-usuarios', navId: 'nav-usuarios', parentId: 'nav-acessos' },
  permissoes: { viewId: 'view-permissoes', navId: 'nav-permissoes', parentId: 'nav-acessos' },
};

const MOBILE_NAV_MQ = window.matchMedia('(max-width: 1024px)');

const VIEW_MOBILE_TITLES = {
  eventos: 'Eventos',
  espacos: 'Espaços',
  arrecadacao: 'Leads comerciais',
  'arrecadacao-planos': 'Planos e produtos',
  artistico: 'Leads artísticos',
  alimentacao: 'Leads alimentação',
  tarefas: 'Tarefas',
  marketing: 'Marketing',
  cronologia: 'Cronologia',
  premiacoes: 'Premiações',
  entregas: 'Entregas',
  materiais: 'Materiais',
  'financeiro-gestao': 'Painel financeiro',
  'financeiro-contas-pagar': 'Contas a pagar',
  'financeiro-plano-contas': 'Plano de contas',
  usuarios: 'Usuários',
  permissoes: 'Permissões',
};

function syncHeaderHeight() {
  const shellHead = document.querySelector('.app-shell-head');
  const header = document.querySelector('.app-header');
  const el = isMobileNav() && shellHead ? shellHead : header || shellHead;
  if (!el) return;
  document.documentElement.style.setProperty('--app-header-height', `${el.offsetHeight}px`);
}

function isMobileNav() {
  return MOBILE_NAV_MQ.matches;
}

function syncEventoSelectorPlacement() {
  const headerSlot = document.querySelector('.header-evento-selector');
  const drawerSlot = document.querySelector('.nav-drawer-evento');
  const select = document.getElementById('evento-select');
  if (!headerSlot || !drawerSlot || !select) return;

  const target = isMobileNav() ? drawerSlot : headerSlot;
  const source = target === headerSlot ? drawerSlot : headerSlot;
  if (!source.contains(select)) return;

  while (source.firstChild) {
    target.appendChild(source.firstChild);
  }
}

function syncNavScrollPlacement() {
  const navScroll = document.querySelector('.nav-scroll');
  const headerInner = document.querySelector('.app-header-inner');
  const shellHead = document.querySelector('.app-shell-head');
  const eventoSlot = document.querySelector('.header-evento-selector');
  if (!navScroll || !headerInner || !shellHead || !eventoSlot) return;

  if (isMobileNav()) {
    if (navScroll.parentElement !== shellHead) {
      shellHead.appendChild(navScroll);
    }
  } else if (navScroll.parentElement !== headerInner) {
    headerInner.insertBefore(navScroll, eventoSlot);
  }
}

function positionDropdownMenu(dropdown) {
  const menu = dropdown.querySelector('.nav-dropdown-menu');
  const toggle = dropdown.querySelector('.nav-dropdown-toggle');
  if (!menu || !toggle || isMobileNav()) return;

  const rect = toggle.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.minWidth = `${Math.max(rect.width, 160)}px`;
}

function resetDropdownMenus() {
  document.querySelectorAll('.nav-dropdown-menu').forEach((menu) => {
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    menu.style.minWidth = '';
  });
}

export function initNavigation({ onViewChange }) {
  let currentView = 'espacos';
  const navDropdowns = [...document.querySelectorAll('.nav-dropdown')];
  const navDrawer = document.getElementById('nav-drawer') || document.querySelector('.nav');
  const navEl = document.querySelector('.nav-drawer-links') || navDrawer;
  const navScrollEl = document.querySelector('.nav-scroll');
  const navMenuToggle = document.getElementById('nav-menu-toggle');
  const navDrawerBackdrop = document.getElementById('nav-drawer-backdrop');
  const navDrawerClose = document.getElementById('nav-drawer-close');
  const navMobileTitle = document.getElementById('nav-mobile-title');
  let drawerScrollY = 0;

  function lockPageScroll() {
    drawerScrollY = window.scrollY;
    document.body.classList.add('nav-scroll-locked');
    document.body.style.top = `-${drawerScrollY}px`;
  }

  function unlockPageScroll() {
    document.body.classList.remove('nav-scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, drawerScrollY);
  }

  function closeAllDropdowns() {
    navDropdowns.forEach((dropdown) => {
      dropdown.classList.remove('open');
      dropdown.querySelector('.nav-dropdown-toggle')?.setAttribute('aria-expanded', 'false');
    });
    resetDropdownMenus();
  }

  function updateNavScrollHints() {
    if (!navEl || !navScrollEl || isMobileNav()) return;
    const maxScroll = navEl.scrollWidth - navEl.clientWidth;
    const atStart = navEl.scrollLeft <= 2;
    const atEnd = maxScroll <= 2 || navEl.scrollLeft >= maxScroll - 2;
    navScrollEl.classList.toggle('is-at-start', atStart);
    navScrollEl.classList.toggle('is-at-end', atEnd);
  }

  function scrollActiveNavIntoView(view) {
    if (!navEl || isMobileNav()) return;
    const link =
      document.getElementById(VIEWS[view]?.navId) ||
      document.querySelector(`.nav-link[data-view="${view}"]`);
    if (!link) return;

    const pad = 16;
    const linkLeft = link.offsetLeft;
    const linkRight = linkLeft + link.offsetWidth;
    const viewLeft = navEl.scrollLeft;
    const viewRight = viewLeft + navEl.clientWidth;

    if (linkLeft < viewLeft + pad) {
      navEl.scrollTo({ left: Math.max(0, linkLeft - pad), behavior: 'smooth' });
    } else if (linkRight > viewRight - pad) {
      navEl.scrollTo({
        left: linkRight - navEl.clientWidth + pad,
        behavior: 'smooth',
      });
    }
    requestAnimationFrame(updateNavScrollHints);
  }

  function setDrawerA11y(open) {
    navDrawer?.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (navDrawer && 'inert' in navDrawer) {
      if (open) navDrawer.removeAttribute('inert');
      else navDrawer.setAttribute('inert', '');
    }
  }

  function openNavDrawer() {
    if (!isMobileNav()) return;
    lockPageScroll();
    document.body.classList.add('nav-drawer-open');
    navMenuToggle?.setAttribute('aria-expanded', 'true');
    navMenuToggle?.setAttribute('aria-label', 'Fechar menu de navegação');
    navDrawerBackdrop?.removeAttribute('hidden');
    setDrawerA11y(true);
    requestAnimationFrame(() => navDrawerClose?.focus());
  }

  function closeNavDrawer() {
    const wasOpen = document.body.classList.contains('nav-drawer-open');
    document.body.classList.remove('nav-drawer-open');
    navMenuToggle?.setAttribute('aria-expanded', 'false');
    navMenuToggle?.setAttribute('aria-label', 'Abrir menu de navegação');
    navDrawerBackdrop?.setAttribute('hidden', '');
    setDrawerA11y(false);
    if (wasOpen) unlockPageScroll();
    closeAllDropdowns();
    if (isMobileNav() && document.activeElement?.closest?.('#nav-drawer')) {
      navMenuToggle?.focus();
    }
  }

  function toggleNavDrawer() {
    if (document.body.classList.contains('nav-drawer-open')) closeNavDrawer();
    else openNavDrawer();
  }

  function bindNavDrawer() {
    navMenuToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleNavDrawer();
    });

    navDrawerBackdrop?.addEventListener('click', closeNavDrawer);
    navDrawerClose?.addEventListener('click', (e) => {
      e.preventDefault();
      closeNavDrawer();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNavDrawer();
    });

    MOBILE_NAV_MQ.addEventListener('change', (e) => {
      syncNavScrollPlacement();
      syncEventoSelectorPlacement();
      closeAllDropdowns();
      updateMobileNavTitle(currentView);
      if (!e.matches) closeNavDrawer();
      else setDrawerA11y(false);
      requestAnimationFrame(syncHeaderHeight);
    });

    const shellHead = document.querySelector('.app-shell-head');
    const header = document.querySelector('.app-header');
    const heightEl = shellHead || header;
    if (heightEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => syncHeaderHeight());
      ro.observe(heightEl);
    }
    window.addEventListener('orientationchange', () => {
      requestAnimationFrame(syncHeaderHeight);
    });
  }

  function bindNavDragScroll() {
    if (!navEl || navEl.dataset.dragScroll === '1' || isMobileNav()) return;
    navEl.dataset.dragScroll = '1';

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    let activePointerId = null;

    navEl.addEventListener(
      'scroll',
      () => {
        updateNavScrollHints();
      },
      { passive: true },
    );

    navEl.addEventListener('pointerdown', (e) => {
      if (isMobileNav()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      moved = false;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startScroll = navEl.scrollLeft;
      navEl.classList.add('is-dragging');
    });

    navEl.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      const delta = e.clientX - startX;
      if (Math.abs(delta) > 4) moved = true;
      if (!moved) return;
      e.preventDefault();
      navEl.scrollLeft = startScroll - delta;
      updateNavScrollHints();
    });

    const endDrag = (e) => {
      if (e.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      navEl.classList.remove('is-dragging');
    };

    navEl.addEventListener('pointerup', endDrag);
    navEl.addEventListener('pointercancel', endDrag);

    navEl.addEventListener(
      'click',
      (e) => {
        if (!moved) return;
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      },
      true,
    );

    window.addEventListener('resize', () => {
      updateNavScrollHints();
      navDropdowns
        .filter((dropdown) => dropdown.classList.contains('open'))
        .forEach(positionDropdownMenu);
    }, { passive: true });
    updateNavScrollHints();
  }

  function setActiveNav(view) {
    document.querySelectorAll('.nav-link').forEach((el) => {
      const isActive = el.dataset.view === view;
      el.classList.toggle('active', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });

    navDropdowns.forEach((dd) => dd.classList.remove('active'));
    if (VIEWS[view]?.parentId) {
      document.getElementById(VIEWS[view].parentId)?.classList.add('active');
    }

    scrollActiveNavIntoView(view);
    updateMobileNavTitle(view);
  }

  function updateMobileNavTitle(view) {
    if (!navMobileTitle) return;
    const title = VIEW_MOBILE_TITLES[view] || 'Gestão';
    navMobileTitle.textContent = title;
    navMobileTitle.toggleAttribute('hidden', !isMobileNav());
  }

  function navigate(view, { replace = false, force = false } = {}) {
    if (!VIEWS[view]) return;
    if (!force && !canAccessView(view)) {
      const fallback = getDefaultView();
      if (fallback) {
        navigate(fallback, { replace, force: true });
      }
      return;
    }
    currentView = view;

    Object.values(VIEWS).forEach(({ viewId }) => {
      document.getElementById(viewId)?.classList.add('hidden');
    });
    document.getElementById(VIEWS[view].viewId)?.classList.remove('hidden');

    setActiveNav(view);
    closeAllDropdowns();
    closeNavDrawer();

    const hash = `#${view}`;
    if (replace) history.replaceState({ view }, '', hash);
    else history.pushState({ view }, '', hash);

    onViewChange?.(view);
    requestAnimationFrame(syncHeaderHeight);
  }

  document.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.view);
    });
  });

  document.getElementById('btn-logout-drawer')?.addEventListener('click', closeNavDrawer);

  navDropdowns.forEach((dropdown) => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    toggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isMobileNav()) return;
      const open = !dropdown.classList.contains('open');
      closeAllDropdowns();
      if (open) {
        dropdown.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        positionDropdownMenu(dropdown);
      }
    });
  });

  document.addEventListener('click', () => {
    if (isMobileNav()) return;
    closeAllDropdowns();
  });

  window.addEventListener('popstate', (e) => {
    let view = e.state?.view || location.hash.replace('#', '') || getDefaultView();
    if (view === 'participantes') view = 'arrecadacao';
    if (view && VIEWS[view] && canAccessView(view)) navigate(view, { replace: true });
    else {
      const fallback = getDefaultView();
      if (fallback) navigate(fallback, { replace: true, force: true });
    }
  });

  const initial = location.hash.replace('#', '');
  let initialView = getDefaultView();
  if (initial === 'participantes') {
    initialView = canAccessView('arrecadacao') ? 'arrecadacao' : getDefaultView();
  } else if (initial && VIEWS[initial] && canAccessView(initial)) {
    initialView = initial;
  }

  applyNavPermissions();
  syncNavScrollPlacement();
  syncEventoSelectorPlacement();
  bindNavDrawer();
  bindNavDragScroll();
  setDrawerA11y(false);
  requestAnimationFrame(syncHeaderHeight);
  if (initialView) {
    navigate(initialView, { replace: true, force: true });
  }

  return { navigate, getCurrentView: () => currentView, applyNavPermissions };
}
