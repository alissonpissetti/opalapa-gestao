const VIEWS = {
  eventos: { viewId: 'view-eventos', navId: 'nav-eventos' },
  espacos: { viewId: 'view-espacos', navId: 'nav-espacos' },
  arrecadacao: { viewId: 'view-arrecadacao', navId: 'nav-arrecadacao' },
  artistico: { viewId: 'view-artistico', navId: 'nav-artistico' },
  tarefas: { viewId: 'view-tarefas', navId: 'nav-tarefas' },
  marketing: { viewId: 'view-marketing', navId: 'nav-marketing' },
  usuarios: { viewId: 'view-usuarios', navId: 'nav-usuarios', parentId: 'nav-acessos' },
};

const MOBILE_NAV_MQ = window.matchMedia('(max-width: 768px)');

function syncHeaderHeight() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
}

function isMobileNav() {
  return MOBILE_NAV_MQ.matches;
}

export function initNavigation({ onViewChange }) {
  let currentView = 'espacos';
  const dropdown = document.getElementById('nav-acessos');
  const dropdownToggle = document.getElementById('nav-acessos-toggle');
  const navDrawer = document.getElementById('nav-drawer') || document.querySelector('.nav');
  const navEl = document.querySelector('.nav-drawer-links') || navDrawer;
  const navScrollEl = document.querySelector('.nav-scroll');
  const navMenuToggle = document.getElementById('nav-menu-toggle');
  const navDrawerBackdrop = document.getElementById('nav-drawer-backdrop');

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

  function openNavDrawer() {
    if (!isMobileNav()) return;
    document.body.classList.add('nav-drawer-open');
    navMenuToggle?.setAttribute('aria-expanded', 'true');
    navMenuToggle?.setAttribute('aria-label', 'Fechar menu de navegação');
    navDrawerBackdrop?.removeAttribute('hidden');
  }

  function closeNavDrawer() {
    document.body.classList.remove('nav-drawer-open');
    navMenuToggle?.setAttribute('aria-expanded', 'false');
    navMenuToggle?.setAttribute('aria-label', 'Abrir menu de navegação');
    navDrawerBackdrop?.setAttribute('hidden', '');
    dropdown?.classList.remove('open');
    dropdownToggle?.setAttribute('aria-expanded', 'false');
  }

  function toggleNavDrawer() {
    if (document.body.classList.contains('nav-drawer-open')) closeNavDrawer();
    else openNavDrawer();
  }

  function bindNavDrawer() {
    navMenuToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNavDrawer();
    });

    navDrawerBackdrop?.addEventListener('click', closeNavDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNavDrawer();
    });

    MOBILE_NAV_MQ.addEventListener('change', (e) => {
      if (!e.matches) closeNavDrawer();
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

    window.addEventListener('resize', updateNavScrollHints, { passive: true });
    updateNavScrollHints();
  }

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

    scrollActiveNavIntoView(view);
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

  dropdownToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMobileNav()) return;
    const open = !dropdown?.classList.contains('open');
    dropdown?.classList.toggle('open', open);
    dropdownToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', () => {
    if (isMobileNav()) return;
    dropdown?.classList.remove('open');
  });

  window.addEventListener('popstate', (e) => {
    let view = e.state?.view || location.hash.replace('#', '') || 'espacos';
    if (view === 'participantes') view = 'arrecadacao';
    if (VIEWS[view]) navigate(view, { replace: true });
  });

  const initial = location.hash.replace('#', '');
  const initialView =
    initial === 'participantes' ? 'arrecadacao' : VIEWS[initial] ? initial : 'espacos';

  bindNavDrawer();
  bindNavDragScroll();
  navigate(initialView, { replace: true });

  return { navigate, getCurrentView: () => currentView };
}
