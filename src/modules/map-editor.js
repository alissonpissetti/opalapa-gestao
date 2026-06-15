import { escapeHtml } from '../lib/format.js';

function parsePoints(pointsStr) {
  if (!pointsStr || !String(pointsStr).trim()) return [];
  return String(pointsStr)
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map((n) => Number(n)))
    .filter((p) => p.length === 2 && !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
}

function formatPoints(pts) {
  return pts.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ');
}

function polygonCentroid(pts) {
  if (!pts.length) return [0, 0];
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [x, y];
}

function clientToSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return [0, 0];
  const loc = pt.matrixTransform(matrix.inverse());
  return [loc.x, loc.y];
}

function clampPoint([x, y], width, height) {
  return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
}

export function initMapEditor({ store, els, spaceLabel, onRender }) {
  let editMode = false;
  let activeNumero = null;
  let snapshot = {};
  let drawing = false;
  let drawPoints = [];
  let drag = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let panDrag = null;
  let spacePan = false;

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;

  const editBar = document.getElementById('map-edit-bar');
  const editSpaces = document.getElementById('map-edit-spaces');
  const editHint = document.getElementById('map-edit-hint');
  const btnToggle = document.getElementById('btn-map-edit-toggle');
  const btnDraw = document.getElementById('btn-map-edit-draw');
  const btnClear = document.getElementById('btn-map-edit-clear');
  const btnSave = document.getElementById('btn-map-edit-save');
  const btnCancel = document.getElementById('btn-map-edit-cancel');
  const mapStage = document.getElementById('map-stage');
  const mapViewport = document.getElementById('map-viewport');
  const zoomControls = document.getElementById('map-zoom-controls');
  const zoomLabel = document.getElementById('map-zoom-label');
  const btnZoomIn = document.getElementById('btn-map-zoom-in');
  const btnZoomOut = document.getElementById('btn-map-zoom-out');
  const btnZoomReset = document.getElementById('btn-map-zoom-reset');

  function clampPan() {
    if (!mapViewport) return;
    const rect = mapViewport.getBoundingClientRect();
    const contentW = rect.width * zoom;
    const contentH = rect.height * zoom;

    if (contentW <= rect.width) panX = (rect.width - contentW) / 2;
    else panX = Math.min(0, Math.max(rect.width - contentW, panX));

    if (contentH <= rect.height) panY = (rect.height - contentH) / 2;
    else panY = Math.min(0, Math.max(rect.height - contentH, panY));
  }

  function applyMapTransform() {
    if (mapStage) {
      mapStage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function resetMapView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyMapTransform();
  }

  function zoomAt(clientX, clientY, factor) {
    if (!mapViewport) return;
    const rect = mapViewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (newZoom === zoom) return;

    const contentX = (px - panX) / zoom;
    const contentY = (py - panY) / zoom;
    zoom = newZoom;
    panX = px - contentX * zoom;
    panY = py - contentY * zoom;
    clampPan();
    applyMapTransform();
  }

  function zoomStep(direction, clientX, clientY) {
    const rect = mapViewport?.getBoundingClientRect();
    const cx = clientX ?? (rect ? rect.left + rect.width / 2 : 0);
    const cy = clientY ?? (rect ? rect.top + rect.height / 2 : 0);
    zoomAt(cx, cy, direction > 0 ? 1.2 : 1 / 1.2);
  }

  function syncPanUi() {
    els.mapWrap?.classList.toggle('map-panning', Boolean(panDrag));
    els.mapWrap?.classList.toggle('map-space-pan', spacePan && !panDrag);
  }

  function isPanTrigger(e) {
    if (e.button === 1 || e.button === 2) return true;
    if (e.button === 0 && spacePan && !e.target.closest('polygon')) return true;
    return false;
  }

  function canStartPan(e) {
    if (!editMode) return false;
    if (!isPanTrigger(e)) return false;
    if (drag) return false;
    if (e.target.closest('.map-vertex, .map-move-handle')) return false;
    return true;
  }

  function bindMapNavigation() {
    mapViewport?.addEventListener(
      'wheel',
      (e) => {
        if (!editMode) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false },
    );

    mapViewport?.addEventListener('pointerdown', (e) => {
      if (!canStartPan(e)) return;
      e.preventDefault();
      panDrag = { x: e.clientX, y: e.clientY, panX, panY };
      mapViewport.setPointerCapture(e.pointerId);
      syncPanUi();
    });

    mapViewport?.addEventListener('pointermove', (e) => {
      if (!panDrag) return;
      e.preventDefault();
      panX = panDrag.panX + (e.clientX - panDrag.x);
      panY = panDrag.panY + (e.clientY - panDrag.y);
      clampPan();
      applyMapTransform();
    });

    const endPan = (e) => {
      if (!panDrag) return;
      panDrag = null;
      if (mapViewport?.hasPointerCapture(e.pointerId)) {
        mapViewport.releasePointerCapture(e.pointerId);
      }
      syncPanUi();
    };

    mapViewport?.addEventListener('pointerup', endPan);
    mapViewport?.addEventListener('pointercancel', endPan);

    mapViewport?.addEventListener('contextmenu', (e) => {
      if (editMode) e.preventDefault();
    });
  }

  function bindZoomButtons() {
    btnZoomIn?.addEventListener('click', () => zoomStep(1));
    btnZoomOut?.addEventListener('click', () => zoomStep(-1));
    btnZoomReset?.addEventListener('click', resetMapView);
  }

  function mapSize() {
    const g = store.currentGrupo;
    return { width: g?.mapWidth || 1024, height: g?.mapHeight || 576 };
  }

  function isEditMode() {
    return editMode;
  }

  function setHint(text) {
    if (editHint) editHint.textContent = text;
  }

  function refreshSpaceChips() {
    if (!editSpaces) return;
    const numeros = store.spaceNumeros();
    editSpaces.innerHTML = numeros
      .map((n) => {
        const hasPoly = Boolean(store.spaces[n]?.points);
        const active = String(n) === String(activeNumero);
        const short = spaceLabel(n).replace(/^Espaço\s+/i, '').replace(/^Tenda\s+/i, 'T');
        return `<button type="button" class="map-edit-space-chip${active ? ' active' : ''}${hasPoly ? ' has-poly' : ''}" data-numero="${n}" role="tab" aria-selected="${active}">${escapeHtml(short)}</button>`;
      })
      .join('');

    editSpaces.querySelectorAll('[data-numero]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectSpace(btn.dataset.numero);
      });
    });
  }

  function takeSnapshot() {
    snapshot = {};
    store.spaceNumeros().forEach((n) => {
      snapshot[n] = store.spaces[n]?.points || '';
    });
  }

  function restoreSnapshot() {
    Object.entries(snapshot).forEach(([n, points]) => {
      if (store.spaces[n]) store.spaces[n].points = points;
    });
  }

  function setActiveNumero(numero) {
    activeNumero = numero != null ? String(numero) : null;
    drawing = false;
    drawPoints = [];
    refreshSpaceChips();
    setHint(
      activeNumero
        ? `Editando ${spaceLabel(activeNumero)} — arraste cantos ou centro. Scroll = zoom · Espaço ou botão direito = mover mapa.`
        : 'Selecione um espaço abaixo ou clique no polígono no mapa.',
    );
    renderEditOverlay();
  }

  function enterEditMode() {
    if (!store.currentGrupo?.mapImage) return;
    editMode = true;
    takeSnapshot();
    resetMapView();
    editBar?.classList.remove('hidden');
    zoomControls?.classList.remove('hidden');
    els.mapWrap?.classList.add('map-edit-mode');
    btnToggle?.classList.add('active');
    btnToggle.textContent = 'Sair da edição';
    refreshSpaceChips();
    const first = store.spaceNumeros()[0];
    setActiveNumero(first ?? null);
    onRender();
  }

  function exitEditMode() {
    editMode = false;
    drawing = false;
    drawPoints = [];
    drag = null;
    panDrag = null;
    spacePan = false;
    activeNumero = null;
    editBar?.classList.add('hidden');
    zoomControls?.classList.add('hidden');
    els.mapWrap?.classList.remove('map-edit-mode', 'map-panning', 'map-space-pan');
    btnToggle?.classList.remove('active');
    btnToggle.textContent = 'Editar mapa';
    resetMapView();
    clearEditOverlay();
    onRender();
  }

  function cancelEdit() {
    restoreSnapshot();
    exitEditMode();
  }

  async function saveEdit() {
    const numeros = store.spaceNumeros();
    const now = new Date().toISOString();
    const updates = numeros.map((numero) => {
      const s = store.spaces[numero];
      return {
        numero: Number(numero),
        status: s.status,
        tipo: s.tipo || '',
        client: s.client || '',
        participanteId: s.participanteId ?? null,
        participanteNome: s.participanteNome || '',
        obs: s.obs || '',
        custo: s.custo ?? null,
        valor: s.valor ?? null,
        saleGroup: s.saleGroup || '',
        points: s.points || '',
        updatedAt: now,
      };
    });

    btnSave.disabled = true;
    try {
      await store.persist(null, updates);
      exitEditMode();
    } catch (err) {
      alert(err.message || 'Falha ao salvar o mapa');
    } finally {
      btnSave.disabled = false;
    }
  }

  function clearEditOverlay() {
    els.mapSvg?.querySelectorAll('.map-edit-layer').forEach((n) => n.remove());
  }

  function renderEditOverlay() {
    clearEditOverlay();
    if (!editMode || !els.mapSvg) return;

    const { width, height } = mapSize();
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('class', 'map-edit-layer');

    if (drawing && drawPoints.length) {
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      preview.setAttribute('class', 'map-draw-preview');
      preview.setAttribute(
        'points',
        drawPoints.map(([x, y]) => `${x},${y}`).join(' '),
      );
      layer.appendChild(preview);

      drawPoints.forEach(([x, y], i) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', 'map-vertex map-vertex--draw');
        c.setAttribute('cx', x);
        c.setAttribute('cy', y);
        c.setAttribute('r', 4);
        c.dataset.drawIndex = String(i);
        layer.appendChild(c);
      });
    }

    if (!activeNumero || drawing) {
      els.mapSvg.appendChild(layer);
      return;
    }

    const pts = parsePoints(store.spaces[activeNumero]?.points);
    if (!pts.length) {
      els.mapSvg.appendChild(layer);
      return;
    }

    pts.forEach(([x, y], index) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'map-vertex');
      c.setAttribute('cx', x);
      c.setAttribute('cy', y);
      c.setAttribute('r', 5);
      c.dataset.numero = activeNumero;
      c.dataset.vertex = String(index);
      layer.appendChild(c);
    });

    const [cx, cy] = polygonCentroid(pts);
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('class', 'map-move-handle');
    handle.setAttribute('cx', cx);
    handle.setAttribute('cy', cy);
    handle.setAttribute('r', 7);
    handle.dataset.numero = activeNumero;
    handle.dataset.move = '1';
    layer.appendChild(handle);

    els.mapSvg.appendChild(layer);
    bindOverlayDrag(layer);
  }

  function applyPoints(numero, pts, { refreshOverlay = true } = {}) {
    const { width, height } = mapSize();
    const clamped = pts.map((p) => clampPoint(p, width, height));
    store.spaces[numero].points = formatPoints(clamped);
    syncPolygonDom(numero);
    if (refreshOverlay) renderEditOverlay();
  }

  function syncOverlayPositions(numero, pts) {
    const layer = els.mapSvg?.querySelector('.map-edit-layer');
    if (!layer) return;
    pts.forEach(([x, y], index) => {
      const v = layer.querySelector(`.map-vertex[data-vertex="${index}"]`);
      if (v) {
        v.setAttribute('cx', x);
        v.setAttribute('cy', y);
      }
    });
    const [cx, cy] = polygonCentroid(pts);
    const handle = layer.querySelector('.map-move-handle');
    if (handle) {
      handle.setAttribute('cx', cx);
      handle.setAttribute('cy', cy);
    }
  }

  function syncPolygonDom(numero) {
    const points = store.spaces[numero]?.points || '';
    const poly = els.mapSvg?.querySelector(`polygon[data-numero="${numero}"]`);
    if (poly) poly.setAttribute('points', points);
    const label = els.mapSvg?.querySelector(`.map-space-label[data-numero="${numero}"]`);
    if (label && points) {
      const [cx, cy] = polygonCentroid(parsePoints(points));
      label.setAttribute('x', cx);
      label.setAttribute('y', cy);
    }
  }

  function bindOverlayDrag(layer) {
    layer.querySelectorAll('.map-vertex, .map-move-handle').forEach((node) => {
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const numero = node.dataset.numero;
        if (!numero) return;

        if (node.dataset.move === '1') {
          const pts = parsePoints(store.spaces[numero].points);
          drag = {
            type: 'move',
            numero,
            start: clientToSvg(els.mapSvg, e.clientX, e.clientY),
            orig: pts,
          };
        } else {
          drag = {
            type: 'vertex',
            numero,
            index: Number(node.dataset.vertex),
            start: clientToSvg(els.mapSvg, e.clientX, e.clientY),
            orig: parsePoints(store.spaces[numero].points),
          };
        }
        node.setPointerCapture(e.pointerId);
      });

      node.addEventListener('pointermove', (e) => {
        if (!drag || drag.numero !== node.dataset.numero) return;
        e.preventDefault();
        const cur = clientToSvg(els.mapSvg, e.clientX, e.clientY);

        if (drag.type === 'vertex') {
          const pts = drag.orig.map((p, i) => (i === drag.index ? cur : [...p]));
          const { width, height } = mapSize();
          const clamped = pts.map((p) => clampPoint(p, width, height));
          store.spaces[drag.numero].points = formatPoints(clamped);
          syncPolygonDom(drag.numero);
          syncOverlayPositions(drag.numero, clamped);
        } else if (drag.type === 'move') {
          const dx = cur[0] - drag.start[0];
          const dy = cur[1] - drag.start[1];
          const pts = drag.orig.map(([x, y]) => [x + dx, y + dy]);
          const { width, height } = mapSize();
          const clamped = pts.map((p) => clampPoint(p, width, height));
          store.spaces[drag.numero].points = formatPoints(clamped);
          syncPolygonDom(drag.numero);
          syncOverlayPositions(drag.numero, clamped);
        }
      });

      node.addEventListener('pointerup', () => {
        if (drag) renderEditOverlay();
        drag = null;
      });
      node.addEventListener('pointercancel', () => {
        drag = null;
      });
    });
  }

  function syncDrawButton() {
    if (!btnDraw) return;
    btnDraw.textContent = drawing ? 'Concluir' : 'Desenhar';
    btnDraw.classList.toggle('active', drawing);
  }

  function startDrawing() {
    if (!activeNumero) return;
    drawing = true;
    drawPoints = parsePoints(store.spaces[activeNumero]?.points);
    if (drawPoints.length < 3) drawPoints = [];
    syncDrawButton();
    setHint(
      `Desenhando ${spaceLabel(activeNumero)} — clique no mapa para adicionar cantos (mín. 3). Conclua ou pressione Enter.`,
    );
    renderEditOverlay();
  }

  function finishDrawing() {
    if (!drawing || drawPoints.length < 3 || !activeNumero) {
      alert('Adicione pelo menos 3 pontos para formar o polígono.');
      return;
    }
    applyPoints(activeNumero, drawPoints);
    drawing = false;
    drawPoints = [];
    syncDrawButton();
    refreshSpaceChips();
    setHint(`Polígono definido para ${spaceLabel(activeNumero)}. Ajuste os cantos ou salve o mapa.`);
    renderEditOverlay();
  }

  function onMapClick(e) {
    if (!editMode || !drawing || spacePan || panDrag) return;
    if (e.target.closest('.map-vertex, .map-move-handle, polygon[data-numero], .map-space-label[data-numero]')) {
      return;
    }

    const [x, y] = clientToSvg(els.mapSvg, e.clientX, e.clientY);
    const { width, height } = mapSize();
    drawPoints.push(clampPoint([x, y], width, height));
    renderEditOverlay();
  }

  function scrollActiveChipIntoView() {
    editSpaces
      ?.querySelector('.map-edit-space-chip.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function selectSpace(numero) {
    if (!editMode || numero == null) return false;
    if (String(numero) === String(activeNumero)) return true;
    setActiveNumero(numero);
    onRender();
    scrollActiveChipIntoView();
    return true;
  }

  function onMapPolygonClick(numero) {
    return selectSpace(numero);
  }

  function bindEvents() {
    btnToggle?.addEventListener('click', () => {
      if (editMode) cancelEdit();
      else enterEditMode();
    });

    btnCancel?.addEventListener('click', cancelEdit);
    btnSave?.addEventListener('click', saveEdit);

    btnDraw?.addEventListener('click', () => {
      if (drawing) finishDrawing();
      else startDrawing();
    });

    btnClear?.addEventListener('click', () => {
      if (!activeNumero) return;
      if (!confirm(`Remover o polígono de ${spaceLabel(activeNumero)}?`)) return;
      store.spaces[activeNumero].points = '';
      drawing = false;
      drawPoints = [];
      syncDrawButton();
      onRender();
      setActiveNumero(activeNumero);
    });

    els.mapSvg?.addEventListener('click', onMapClick);

    document.addEventListener('keydown', (e) => {
      if (!editMode) return;
      if (e.code === 'Space' && !e.repeat) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault();
        spacePan = true;
        syncPanUi();
      }
      if (e.key === 'Enter' && drawing) {
        e.preventDefault();
        finishDrawing();
      }
      if (e.key === 'Escape') {
        if (drawing) {
          drawing = false;
          drawPoints = [];
          syncDrawButton();
          renderEditOverlay();
          setHint(`Edição de ${spaceLabel(activeNumero)} cancelada.`);
        } else {
          cancelEdit();
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spacePan = false;
        panDrag = null;
        syncPanUi();
      }
    });

    bindMapNavigation();
    bindZoomButtons();
  }

  return {
    isEditMode,
    getActiveNumero: () => activeNumero,
    selectSpace,
    onMapRendered: renderEditOverlay,
    onMapPolygonClick,
    onGrupoChanged: () => {
      if (editMode) cancelEdit();
    },
    bindEvents,
  };
}
