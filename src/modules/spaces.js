import { COLORS, LABELS, STATUS_ORDER } from '../lib/constants.js';
import { defaultSpace } from '../lib/store.js';
import { fetchTiposComercio, fetchFunilEtapas, fetchEspacosDisponiveis } from '../lib/api.js';
import {
  fmtDate,
  fmtMoney,
  fmtPercent,
  parseValor,
  formatValorInput,
  maskValorInput,
  escapeHtml,
  sortIds,
  idsLabel,
  isSaleGroupValorLeader,
  saleGroupLeader,
  valorNegociadoExibido,
  valoresPagamentoExibidos,
} from '../lib/format.js';
import { exportCSV } from './export.js';
import { initMapEditor } from './map-editor.js';

const VIEW_MODE_KEY = 'espacos-view-mode';

export function initSpacesModule(store) {
  const {
    spaces,
    persist,
    moveReserva,
    moveReservas,
    isActiveStatus,
    totalNegociado,
    totalPago,
    totalFalta,
    totalCusto,
    totalsByStatus,
    spaceNumeros,
    switchGrupo,
  } = store;

  let editNumeros = [];
  let listFilter = 'all';
  let viewMode = localStorage.getItem(VIEW_MODE_KEY) === 'kanban' ? 'kanban' : 'lista';
  let funilEtapas = [];
  let draggingNumero = null;
  let kanbanCardWasDragged = false;
  const selectedNumeros = new Set();
  const els = {
    grupoTabs: document.getElementById('grupo-tabs'),
    grupoTitle: document.getElementById('grupo-title'),
    stTotal: document.getElementById('st-total'),
    stDisp: document.getElementById('st-disp'),
    stLead: document.getElementById('st-lead'),
    stNeg: document.getElementById('st-neg'),
    stRes: document.getElementById('st-res'),
    stVend: document.getElementById('st-vend'),
    statusTotals: document.getElementById('status-totals'),
    selectBar: document.getElementById('select-bar'),
    selCount: document.getElementById('sel-count'),
    selNums: document.getElementById('sel-nums'),
    btnContinue: document.getElementById('btn-continue'),
    btnEditCusto: document.getElementById('btn-edit-custo'),
    custoModalBg: document.getElementById('custo-modal-bg'),
    custoModalTitle: document.getElementById('custo-modal-title'),
    custoModalSub: document.getElementById('custo-modal-sub'),
    bulkCusto: document.getElementById('bulk-custo'),
    custoBtnCancel: document.getElementById('custo-btn-cancel'),
    custoBtnSave: document.getElementById('custo-btn-save'),
    mCustoHint: document.getElementById('m-custo-hint'),
    spacesTable: document.getElementById('spaces-table'),
    reportRoot: document.getElementById('espacos-report'),
    listaView: document.getElementById('espacos-lista-view'),
    kanbanView: document.getElementById('espacos-kanban-view'),
    reportSummary: document.getElementById('report-summary'),
    chkAll: document.getElementById('chk-all'),
    modalBg: document.getElementById('modal-bg'),
    modalTitle: document.getElementById('modal-title'),
    mLbl: document.getElementById('m-lbl'),
    mStatus: document.getElementById('m-status'),
    mTipo: document.getElementById('m-tipo'),
    mCustoField: document.getElementById('m-custo-field'),
    mCusto: document.getElementById('m-custo'),
    mValor: document.getElementById('m-valor'),
    mValorHint: document.getElementById('m-valor-hint'),
    mParticipanteField: document.getElementById('m-participante-field'),
    mParticipante: document.getElementById('m-participante'),
    mParticipanteId: document.getElementById('m-participante-id'),
    mObs: document.getElementById('m-obs'),
    mMoveField: document.getElementById('m-move-field'),
    mMoveLabel: document.getElementById('m-move-label'),
    mMoveDestino: document.getElementById('m-move-destino'),
    mMoveHint: document.getElementById('m-move-hint'),
    btnClear: document.getElementById('btn-clear'),
    btnSave: document.getElementById('btn-save'),
    mapWrap: document.getElementById('map-wrap'),
    mapEmpty: document.getElementById('map-empty'),
    mapImage: document.getElementById('map-image'),
    mapSvg: document.getElementById('map-svg'),
    btnExport: document.getElementById('btn-export'),
    btnPrint: document.getElementById('btn-print'),
    syncStatus: document.getElementById('sync-status'),
  };

  function spaceLabel(numero) {
    return spaces[numero]?.label || `Espaço ${numero}`;
  }

  function statusLabel(status) {
    const etapa = funilEtapas.find((e) => e.status === status);
    return etapa?.titulo || LABELS[status] || status;
  }

  function statusColor(status) {
    const etapa = funilEtapas.find((e) => e.status === status);
    return etapa?.cor || COLORS[status] || COLORS.disp;
  }

  /** Etapas do funil usadas nos espaços: Disponível + pipeline comercial (sem Perda). */
  function spaceStatusEtapas() {
    const fromFunil = funilEtapas
      .filter((e) => e.ativo !== false && e.tipo !== 'perda')
      .sort((a, b) => a.ordem - b.ordem);

    if (fromFunil.length) {
      if (!fromFunil.some((e) => e.status === 'disp')) {
        return [
          { status: 'disp', titulo: LABELS.disp, cor: COLORS.disp },
          ...fromFunil,
        ];
      }
      return fromFunil;
    }

    return STATUS_ORDER.map((status) => ({
      status,
      titulo: LABELS[status],
      cor: COLORS[status],
    }));
  }

  function renderStatusSelectOptions(selected = 'disp') {
    if (!els.mStatus) return;
    const etapas = spaceStatusEtapas();
    els.mStatus.innerHTML = etapas
      .map(
        (e) =>
          `<option value="${escapeHtml(e.status)}"${e.status === selected ? ' selected' : ''}>${escapeHtml(e.titulo || LABELS[e.status] || e.status)}</option>`,
      )
      .join('');
  }

  async function loadFunilEtapas() {
    try {
      const data = await fetchFunilEtapas();
      funilEtapas = data.etapas || [];
    } catch (_) {
      funilEtapas = [];
    }
    renderStatusSelectOptions();
  }

  function hasSpaces() {
    return spaceNumeros().length > 0;
  }

  function updateSyncStatus() {
    if (!els.syncStatus) return;
    if (store.saving) {
      els.syncStatus.textContent = 'Salvando no banco…';
      els.syncStatus.className = 'sync-status saving';
    } else if (store.saveError) {
      els.syncStatus.textContent = `Erro ao salvar: ${store.saveError}`;
      els.syncStatus.className = 'sync-status error';
    } else {
      els.syncStatus.textContent = 'Dados salvos no banco de dados';
      els.syncStatus.className = 'sync-status ok';
    }
  }

  function renderGrupoTabs() {
    els.grupoTabs.innerHTML = store.grupos
      .map(
        (g) => `
        <button
          type="button"
          class="grupo-tab ${store.currentGrupo?.slug === g.slug ? 'active' : ''}"
          data-slug="${g.slug}"
          role="tab"
          aria-selected="${store.currentGrupo?.slug === g.slug}"
        >${escapeHtml(g.nome)}</button>
      `,
      )
      .join('');

    els.grupoTabs.querySelectorAll('[data-slug]').forEach((btn) => {
      btn.addEventListener('click', () => selectGrupo(btn.dataset.slug));
    });

    if (store.currentGrupo) {
      els.grupoTitle.textContent = store.currentGrupo.nome;
    }
  }

  async function selectGrupo(slug) {
    try {
      mapEditor.onGrupoChanged();
      await switchGrupo(slug);
      clearSelection();
      renderGrupoTabs();
      renderAll();
      updateSyncStatus();
    } catch (err) {
      alert(err.message);
    }
  }

  function updateMapLayout() {
    const grupo = store.currentGrupo;
    const empty = !hasSpaces() || !grupo?.mapImage;

    els.mapWrap.classList.toggle('hidden', empty);
    els.mapEmpty.classList.toggle('hidden', !empty);

    if (empty) {
      els.mapEmpty.textContent = hasSpaces()
        ? 'Mapa ainda não configurado para este agrupamento.'
        : 'Nenhum espaço cadastrado neste agrupamento.';
      return;
    }

    els.mapImage.src = grupo.mapImage;
    els.mapImage.alt = `Mapa — ${grupo.nome}`;
    els.mapImage.width = grupo.mapWidth;
    els.mapImage.height = grupo.mapHeight;
    els.mapWrap.style.aspectRatio = `${grupo.mapWidth} / ${grupo.mapHeight}`;
    els.mapSvg.setAttribute('viewBox', `0 0 ${grupo.mapWidth} ${grupo.mapHeight}`);
    els.mapSvg.setAttribute('preserveAspectRatio', 'none');
  }

  function polygonCentroid(pointsStr) {
    const pts = pointsStr
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number));
    if (!pts.length) return [0, 0];
    const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [x, y];
  }

  function renderMapPolygons() {
    updateMapLayout();
    if (!hasSpaces() || !store.currentGrupo?.mapImage) {
      els.mapSvg.innerHTML = '';
      return;
    }

    const numeros = [...spaceNumeros()].sort((a, b) => b - a);
    const editing = mapEditor.isEditMode();
    els.mapSvg.innerHTML = numeros
      .filter((n) => spaces[n]?.points || editing)
      .map((n) => {
        const points = spaces[n]?.points || '';
        const hasPoly = Boolean(points);
        const active = editing && String(mapEditor.getActiveNumero()) === String(n);
        const polyClass = active ? ' map-poly-editing' : '';
        const poly = hasPoly
          ? `<polygon class="map-poly${polyClass}" data-numero="${n}" data-lbl="${escapeHtml(spaceLabel(n))}" points="${points}"></polygon>`
          : `<polygon class="map-poly map-poly--empty${active ? ' map-poly-editing' : ''}" data-numero="${n}" data-lbl="${escapeHtml(spaceLabel(n))}" points=""></polygon>`;
        if (!hasPoly) {
          return poly;
        }
        const [cx, cy] = polygonCentroid(points);
        return `${poly}<text class="map-space-label" x="${cx}" y="${cy}" data-numero="${n}" text-anchor="middle" dominant-baseline="central">${escapeHtml(String(n))}</text>`;
      })
      .join('');

    mapEditor.onMapRendered();
  }

  function renderMapPolygonStyles() {
    document.querySelectorAll('#map-svg polygon').forEach((poly) => {
      const numero = poly.dataset.numero;
      const data = spaces[numero];
      const color = statusColor(data?.status || 'disp');
      const editing = mapEditor.isEditMode();
      const active = editing && String(mapEditor.getActiveNumero()) === String(numero);
      poly.classList.toggle('map-poly-editing', active);
      if (editing) {
        poly.setAttribute('fill', active ? '#facc15' : color);
        poly.setAttribute('fill-opacity', active ? '0.35' : '0.22');
      } else {
        poly.setAttribute('fill', color);
        poly.setAttribute('fill-opacity', '0.38');
      }
    });
  }

  const mapEditor = initMapEditor({
    store,
    els,
    spaceLabel,
    onRender: () => {
      renderMapPolygons();
      renderMapPolygonStyles();
    },
  });

  async function loadTiposComercio() {
    try {
      const data = await fetchTiposComercio();
      store.setTiposComercio(data.tipos || []);
    } catch (_) {
      store.setTiposComercio([]);
    }
    renderTiposComercio();
  }

  function renderParticipantesDatalist() {
    const datalist = document.getElementById('participantes-list');
    if (!datalist) return;
    const list = [...store.participantes].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    );
    datalist.innerHTML = list
      .map((p) => `<option value="${escapeHtml(p.nome)}"></option>`)
      .join('');
  }

  function matchParticipanteByNome(nome) {
    const q = String(nome || '').trim().toLowerCase();
    if (!q) return null;
    return store.participantes.find((p) => p.nome.toLowerCase() === q) || null;
  }

  function readParticipanteInput() {
    const nome = els.mParticipante.value.trim();
    if (!nome) return { participanteId: null, participanteNome: '' };
    const matched = matchParticipanteByNome(nome);
    if (matched) return { participanteId: matched.id, participanteNome: matched.nome };
    const id = els.mParticipanteId.value ? Number(els.mParticipanteId.value) : null;
    if (id) {
      const byId = store.participantes.find((p) => p.id === id);
      if (byId) return { participanteId: byId.id, participanteNome: byId.nome };
    }
    return { participanteId: null, participanteNome: nome };
  }

  function syncParticipanteIdFromInput() {
    const matched = matchParticipanteByNome(els.mParticipante.value);
    els.mParticipanteId.value = matched ? String(matched.id) : '';
  }

  function renderTiposComercio() {
    const datalist = document.getElementById('tipos-comercio');
    const tipos = [...store.tiposComercio].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
    );
    datalist.innerHTML = tipos.map((t) => `<option value="${escapeHtml(t)}">`).join('');
  }

  function updateSelectionUi() {
    const sorted = sortIds(selectedNumeros);
    els.selectBar.classList.toggle('visible', sorted.length > 0);
    els.selCount.textContent = sorted.length;
    els.selNums.textContent = sorted.join(', ');
    els.btnContinue.disabled = sorted.length === 0;
    els.btnContinue.textContent =
      sorted.length > 1 ? `Continuar (${sorted.length} espaços)` : 'Continuar';
    if (els.btnEditCusto) {
      els.btnEditCusto.disabled = sorted.length === 0;
      els.btnEditCusto.textContent =
        sorted.length > 1 ? `Alterar custo (${sorted.length})` : 'Alterar custo';
    }

    document.querySelectorAll('#map-svg polygon').forEach((poly) => {
      poly.classList.toggle('selected', selectedNumeros.has(poly.dataset.numero));
    });

    document.querySelectorAll('#map-svg .map-space-label').forEach((label) => {
      label.classList.toggle('selected', selectedNumeros.has(label.dataset.numero));
    });

    document.querySelectorAll('#spaces-table tr[data-numero]').forEach((row) => {
      const numero = row.dataset.numero;
      row.classList.toggle('selected-row', selectedNumeros.has(numero));
      const chk = row.querySelector('.row-chk');
      if (chk) chk.checked = selectedNumeros.has(numero);
    });

    const visible = [...document.querySelectorAll('#spaces-table tr[data-numero]')];
    const checked = visible.filter((row) => selectedNumeros.has(row.dataset.numero));
    els.chkAll.checked = visible.length > 0 && checked.length === visible.length;
    els.chkAll.indeterminate = checked.length > 0 && checked.length < visible.length;
  }

  function toggleSelect(numero, force) {
    if (mapEditor.isEditMode()) return;
    const key = String(numero);
    const on = force !== undefined ? force : !selectedNumeros.has(key);
    if (on) selectedNumeros.add(key);
    else selectedNumeros.delete(key);
    updateSelectionUi();
  }

  function clearSelection() {
    selectedNumeros.clear();
    updateSelectionUi();
  }

  function toggleSelectAll(checked) {
    document.querySelectorAll('#spaces-table tr[data-numero]').forEach((row) => {
      if (checked) selectedNumeros.add(row.dataset.numero);
      else selectedNumeros.delete(row.dataset.numero);
    });
    updateSelectionUi();
  }

  function continueSelection() {
    if (selectedNumeros.size < 1) return;
    openSpaces(sortIds(selectedNumeros));
  }

  function buildSpacePayload(numero, patch) {
    const prev = spaces[numero] || defaultSpace(Number(numero));
    const next = { ...prev, ...patch };
    spaces[numero] = next;
    return {
      numero: Number(numero),
      status: next.status,
      tipo: next.tipo || '',
      client: next.client || '',
      participanteId: next.participanteId ?? null,
      participanteNome: next.participanteNome || '',
      obs: next.obs || '',
      custo: next.custo ?? null,
      valor: next.valor ?? null,
      saleGroup: next.saleGroup || '',
      updatedAt: next.updatedAt,
    };
  }

  function openBulkCustoModal() {
    const list = sortIds(selectedNumeros);
    if (!list.length) return;

    const rows = list.map((n) => spaces[n]);
    const first = rows[0];
    const sameCusto = rows.every((r) => r.custo === first.custo);

    els.custoModalTitle.textContent =
      list.length === 1
        ? `Alterar custo — ${spaceLabel(list[0])}`
        : `Alterar custo — ${list.length} espaços`;
    els.custoModalSub.textContent = list.length > 1 ? idsLabel(list) : '';
    els.bulkCusto.value = sameCusto ? formatValorInput(first.custo) : '';
    els.custoModalBg.classList.add('open');
    els.bulkCusto.focus();
  }

  function closeBulkCustoModal() {
    els.custoModalBg.classList.remove('open');
  }

  async function saveBulkCusto() {
    const list = sortIds(selectedNumeros);
    if (!list.length) return;

    const custo = parseValor(els.bulkCusto.value);
    if (custo == null) {
      alert('Informe o valor de custo.');
      return;
    }

    const now = new Date().toISOString();
    const updates = list.map((numero) => buildSpacePayload(numero, { custo, updatedAt: now }));

    els.custoBtnSave.disabled = true;
    els.custoBtnSave.textContent = 'Salvando…';
    updateSyncStatus();
    try {
      await persist(null, updates);
      renderAll();
      clearSelection();
      closeBulkCustoModal();
    } catch (err) {
      renderAll();
      alert(err.message || 'Falha ao salvar o custo');
    } finally {
      els.custoBtnSave.disabled = false;
      els.custoBtnSave.textContent = 'Salvar';
      updateSyncStatus();
    }
  }

  function readModalForm(isBulk) {
    const form = {
      status: els.mStatus.value,
      tipo: els.mTipo.value.trim(),
      client: '',
      obs: els.mObs.value.trim(),
      valor: parseValor(els.mValor.value),
    };
    return form;
  }

  function resolveCustoForSave(isBulk, prev) {
    const parsed = parseValor(els.mCusto.value);
    if (isBulk && parsed == null) return prev.custo ?? null;
    return parsed;
  }

  function buildSaveUpdates(isBulk, form, saleGroup, now) {
    const participanteInput = readParticipanteInput();

    return editNumeros.map((numero) => {
      const prev = spaces[numero] || defaultSpace(Number(numero));
      const custo = resolveCustoForSave(isBulk, prev);
      const participanteId = participanteInput.participanteId ?? null;
      const participanteNome = participanteInput.participanteNome || '';
      const next = {
        ...prev,
        ...form,
        custo,
        participanteId,
        participanteNome,
        saleGroup: isBulk ? saleGroup : prev.saleGroup || '',
        updatedAt: now,
      };
      spaces[numero] = next;
      return {
        numero: Number(numero),
        status: next.status,
        tipo: next.tipo || '',
        client: next.client || '',
        participanteId: next.participanteId ?? null,
        participanteNome: next.participanteNome || '',
        obs: next.obs || '',
        custo: next.custo ?? null,
        valor: next.valor ?? null,
        saleGroup: next.saleGroup || '',
        updatedAt: next.updatedAt,
      };
    });
  }

  function expandMoveSet(numeros) {
    const set = new Set(numeros.map(String));
    for (const n of [...set]) {
      const saleGroup = spaces[n]?.saleGroup;
      if (!saleGroup) continue;
      Object.keys(spaces).forEach((key) => {
        if (spaces[key]?.saleGroup === saleGroup) set.add(String(key));
      });
    }
    return sortIds(set).filter((n) => isActiveStatus(spaces[n]?.status));
  }

  function parseDestinoOptionValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const sep = raw.indexOf(':');
    if (sep <= 0) {
      return {
        destinoGrupoSlug: store.currentGrupo?.slug || '',
        destinoNumero: Number(raw),
      };
    }
    return {
      destinoGrupoSlug: raw.slice(0, sep),
      destinoNumero: Number(raw.slice(sep + 1)),
    };
  }

  function parseDestinoOptionValues(selectEl, expectedCount) {
    if (!selectEl) return [];
    const values = selectEl.multiple
      ? [...selectEl.selectedOptions].map((o) => o.value).filter(Boolean)
      : selectEl.value
        ? [selectEl.value]
        : [];
    if (!values.length) return [];
    if (expectedCount > 1 && values.length !== expectedCount) {
      throw new Error(`Selecione exatamente ${expectedCount} espaços de destino.`);
    }
    return values.map((v) => parseDestinoOptionValue(v));
  }

  async function renderMoveDestinoOptions(origemNumeros) {
    if (!els.mMoveDestino) return;

    const origens = sortIds(origemNumeros).map(String);
    const origemKeys = new Set(
      origens.map((n) => `${store.currentGrupo?.slug || ''}:${n}`),
    );
    let disponiveis = [];

    try {
      const data = await fetchEspacosDisponiveis();
      disponiveis = data.espacos || [];
    } catch {
      const origemSlug = store.currentGrupo?.slug || '';
      disponiveis = spaceNumeros()
        .filter((n) => {
          const s = spaces[n];
          return (
            s?.status === 'disp' &&
            !s?.participanteId &&
            !s?.saleGroup &&
            !origens.includes(String(n))
          );
        })
        .map((n) => ({
          numero: n,
          label: spaceLabel(n),
          grupoSlug: origemSlug,
          grupoNome: store.currentGrupo?.nome || '',
        }));
    }

    const filtered = disponiveis.filter(
      (e) => !origemKeys.has(`${e.grupoSlug}:${e.numero}`),
    );

    const byGrupo = new Map();
    filtered.forEach((espaco) => {
      const key = espaco.grupoSlug || store.currentGrupo?.slug || '';
      if (!byGrupo.has(key)) {
        byGrupo.set(key, { nome: espaco.grupoNome || key, items: [] });
      }
      byGrupo.get(key).items.push(espaco);
    });

    const isMulti = origens.length > 1;
    els.mMoveDestino.multiple = isMulti;
    els.mMoveDestino.size = isMulti ? Math.min(10, Math.max(4, origens.length + 1)) : 1;

    const options = isMulti
      ? []
      : ['<option value="">Manter neste espaço</option>'];
    [...byGrupo.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .forEach((grupo) => {
        options.push(`<optgroup label="${escapeHtml(grupo.nome)}">`);
        grupo.items
          .sort((a, b) => a.numero - b.numero)
          .forEach((espaco) => {
            const value = `${espaco.grupoSlug}:${espaco.numero}`;
            options.push(
              `<option value="${escapeHtml(value)}">${escapeHtml(espaco.label)}</option>`,
            );
          });
        options.push('</optgroup>');
      });

    els.mMoveDestino.innerHTML = options.join('');
    els.mMoveDestino.value = '';
  }

  async function syncMoveField(list) {
    if (!els.mMoveField || !els.mMoveDestino) return;

    const moveSet = expandMoveSet(list);
    const canMove =
      moveSet.length > 0 && moveSet.every((n) => isActiveStatus(spaces[n]?.status));

    els.mMoveField.classList.toggle('hidden', !canMove);
    if (!canMove) {
      els.mMoveDestino.multiple = false;
      els.mMoveDestino.size = 1;
      els.mMoveDestino.value = '';
      return;
    }

    const isGroupSale = moveSet.some((n) => spaces[n]?.saleGroup);
    if (els.mMoveLabel) {
      els.mMoveLabel.textContent =
        moveSet.length > 1
          ? `Mover ${moveSet.length} espaços para outros destinos`
          : 'Mover reserva para outro espaço';
    }

    await renderMoveDestinoOptions(moveSet);
    if (els.mMoveHint) {
      if (moveSet.length > 1) {
        els.mMoveHint.textContent = isGroupSale
          ? `Selecione ${moveSet.length} destinos (Ctrl+clique). A venda em grupo será mantida. Cada origem (${idsLabel(moveSet)}) vai para o destino correspondente por ordem numérica.`
          : `Selecione ${moveSet.length} destinos (Ctrl+clique). Cada origem (${idsLabel(moveSet)}) é pareada ao destino de mesma posição na ordem numérica.`;
      } else {
        els.mMoveHint.textContent =
          'Transfere participante, status e valores para o espaço escolhido em qualquer agrupamento e libera o atual. Pagamentos na arrecadação são mantidos.';
      }
    }
  }

  function fillModalForm(data, isBulk) {
    renderStatusSelectOptions(data.status || 'disp');
    els.mStatus.value = data.status || 'disp';
    els.mTipo.value = data.tipo || '';
    els.mParticipante.value = data.participanteNome || '';
    els.mParticipanteId.value = data.participanteId ? String(data.participanteId) : '';
    els.mObs.value = data.obs || '';
    els.mCusto.value = formatValorInput(data.custo);
    els.mValor.value = formatValorInput(data.valor);

    if (els.mCustoHint) {
      els.mCustoHint.textContent =
        isBulk && editNumeros.length > 1
          ? 'Aplicado a todos os espaços selecionados. Deixe vazio para manter o custo atual de cada um.'
          : 'Valor pré-definido deste espaço, independente da negociação.';
    }

    if (isBulk && editNumeros.length > 1) {
      els.mValorHint.textContent = `Valor total da venda para os ${editNumeros.length} espaços (contado uma vez no relatório).`;
    } else {
      els.mValorHint.textContent = '';
    }
  }

  function setFilter(filter) {
    listFilter = filter;
    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    if (viewMode === 'kanban') renderKanban();
    else renderTable();
  }

  async function openSpaces(numeros) {
    const list = sortIds(numeros).map(String);
    if (!list.length) return;

    editNumeros = list;
    const isBulk = list.length > 1;
    const first = spaces[list[0]];

    if (isBulk) {
      const rows = list.map((n) => spaces[n]);
      const sameField = (key) => rows.every((r) => r[key] === first[key]);
      const sameParticipante =
        sameField('participanteId') && sameField('participanteNome');
      const sameCusto = sameField('custo');

      els.modalTitle.innerHTML = `Venda em grupo <span id="m-num">${list.length} espaços</span>`;
      els.mLbl.textContent = idsLabel(list);
      els.btnClear.textContent = 'Limpar todos';
      els.btnSave.textContent = `Salvar em ${list.length} espaços`;
      fillModalForm(
        {
          status: 'vend',
          tipo: sameField('tipo') ? first.tipo : '',
          participanteId: sameParticipante ? first.participanteId : null,
          participanteNome: sameParticipante ? first.participanteNome : '',
          obs: sameField('obs') ? first.obs : '',
          valor: sameField('valor') ? first.valor : null,
          custo: sameCusto ? first.custo : null,
        },
        true,
      );
    } else {
      const numero = list[0];
      els.modalTitle.innerHTML = `Espaço <span id="m-num">${numero}</span>`;
      els.mLbl.textContent = spaceLabel(numero);
      els.btnClear.textContent = 'Limpar';
      els.btnSave.textContent = 'Salvar';
      fillModalForm(spaces[numero], false);
    }

    await syncMoveField(list);
    els.modalBg.classList.add('open');
  }

  function openSpace(numero) {
    if (mapEditor.isEditMode()) {
      mapEditor.selectSpace(numero);
      return;
    }
    clearSelection();
    openSpaces([numero]);
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    if (els.mMoveDestino) els.mMoveDestino.value = '';
    editNumeros = [];
  }

  function buildMovePayload(form, now) {
    const participanteInput = readParticipanteInput();
    return {
      status: form.status,
      tipo: form.tipo,
      client: '',
      obs: form.obs,
      valor: form.valor,
      participanteId: participanteInput.participanteId,
      participanteNome: participanteInput.participanteNome,
      updatedAt: now,
    };
  }

  async function saveSpace() {
    if (!editNumeros.length) return;
    const isBulk = editNumeros.length > 1;
    const form = readModalForm(isBulk);
    const now = new Date().toISOString();
    const moveSet = expandMoveSet(editNumeros);
    let destinos = [];
    try {
      destinos = parseDestinoOptionValues(els.mMoveDestino, moveSet.length);
    } catch (err) {
      alert(err.message);
      return;
    }
    const isMove = destinos.length > 0;

    els.btnSave.disabled = true;
    updateSyncStatus();
    try {
      if (isMove) {
        const sortedDestinos = [...destinos].sort((a, b) => {
          if (a.destinoGrupoSlug !== b.destinoGrupoSlug) {
            return a.destinoGrupoSlug.localeCompare(b.destinoGrupoSlug);
          }
          return a.destinoNumero - b.destinoNumero;
        });
        const movimentos = moveSet.map((origemNumero, index) => ({
          origemNumero: Number(origemNumero),
          destinoGrupoSlug: sortedDestinos[index].destinoGrupoSlug,
          destinoNumero: sortedDestinos[index].destinoNumero,
        }));
        await moveReservas(movimentos, buildMovePayload(form, now));
      } else {
        const saleGroup = isBulk ? `grupo-${store.currentGrupo.slug}-${Date.now()}` : '';
        const updates = buildSaveUpdates(isBulk, form, saleGroup, now);
        await persist(null, updates);
      }
      renderTiposComercio();
      renderParticipantesDatalist();
      renderAll();
      clearSelection();
      closeModal();
    } catch (err) {
      renderAll();
      alert(err.message || (isMove ? 'Falha ao mover a reserva' : 'Falha ao salvar o espaço'));
    } finally {
      els.btnSave.disabled = false;
      updateSyncStatus();
    }
  }

  async function clearSpace() {
    if (!editNumeros.length) return;
    const now = new Date().toISOString();
    const numeros = [...editNumeros];

    numeros.forEach((numero) => {
      spaces[numero] = {
        ...defaultSpace(Number(numero)),
        label: spaces[numero].label,
        points: spaces[numero].points,
        custo: spaces[numero].custo,
        updatedAt: now,
      };
    });

    els.btnClear.disabled = true;
    updateSyncStatus();
    try {
      await persist(numeros);
      renderAll();
      clearSelection();
      closeModal();
    } catch (_) {
      renderAll();
    } finally {
      els.btnClear.disabled = false;
      updateSyncStatus();
    }
  }

  function filteredSpaceNumeros() {
    const numeros = spaceNumeros();
    return numeros.filter((numero) => {
      const data = spaces[numero];
      if (listFilter === 'active' && !isActiveStatus(data.status)) return false;
      if (listFilter !== 'all' && listFilter !== 'active' && data.status !== listFilter) return false;
      return true;
    });
  }

  function applyViewModeUi() {
    const isKanban = viewMode === 'kanban';
    els.reportRoot?.classList.toggle('page--kanban', isKanban);
    els.listaView?.classList.toggle('hidden', isKanban);
    if (els.listaView) els.listaView.hidden = isKanban;
    els.kanbanView?.classList.toggle('hidden', !isKanban);
    if (els.kanbanView) els.kanbanView.hidden = !isKanban;
  }

  function setViewMode(mode) {
    viewMode = mode === 'kanban' ? 'kanban' : 'lista';
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
    document.querySelectorAll('[data-esp-view]').forEach((btn) => {
      const active = btn.dataset.espView === viewMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    applyViewModeUi();
    if (viewMode === 'kanban') renderKanban();
    else renderTable();
  }

  async function moveSpaceToStatus(numero, newStatus) {
    const key = String(numero);
    const prev = spaces[key];
    if (!prev || prev.status === newStatus) return;

    if (prev.saleGroup) {
      alert('Espaços em venda em grupo não podem ser movidos individualmente no kanban.');
      return;
    }

    const now = new Date().toISOString();
    let patch;

    if (newStatus === 'disp') {
      patch = {
        status: 'disp',
        tipo: '',
        client: '',
        participanteId: null,
        participanteNome: '',
        obs: '',
        valor: null,
        saleGroup: '',
        updatedAt: now,
      };
    } else {
      patch = { status: newStatus, updatedAt: now };
    }

    try {
      await persist(null, [buildSpacePayload(key, patch)]);
      renderAll();
    } catch (err) {
      renderAll();
      alert(err.message || 'Falha ao atualizar o status do espaço');
    }
  }

  function renderKanbanCard(numero) {
    const data = spaces[numero];
    const participante = data.participanteNome || '';
    const valorExibido = valorNegociadoExibido(spaces, numero, data);
    const groupNote = data.saleGroup ? ' · grupo' : '';
    const draggable = data.saleGroup ? 'false' : 'true';

    return `
      <article class="arr-kanban-card" draggable="${draggable}" data-numero="${numero}">
        <div class="arr-kanban-card-head">
          <strong>${escapeHtml(spaceLabel(numero))}${groupNote}</strong>
        </div>
        <div class="arr-kanban-card-ref">${participante ? escapeHtml(participante) : 'Sem participante'}</div>
        <div class="arr-kanban-card-valores">
          <span>${data.tipo ? escapeHtml(data.tipo) : '—'}</span>
          <span>${valorExibido != null ? fmtMoney(valorExibido) : '—'}</span>
        </div>
      </article>
    `;
  }

  function bindKanbanInteractions(root) {
    if (!root) return;

    root.querySelectorAll('.arr-kanban-card[draggable="true"]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        kanbanCardWasDragged = false;
        draggingNumero = card.dataset.numero;
        e.dataTransfer.setData('text/plain', draggingNumero);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
        kanbanCardWasDragged = true;
      });
      card.addEventListener('dragend', () => {
        draggingNumero = null;
        card.classList.remove('dragging');
        root.querySelectorAll('.arr-kanban-col-body').forEach((col) => {
          col.classList.remove('drag-over');
        });
        setTimeout(() => {
          kanbanCardWasDragged = false;
        }, 0);
      });
      card.addEventListener('click', () => {
        if (kanbanCardWasDragged) return;
        openSpace(card.dataset.numero);
      });
    });

    root.querySelectorAll('.arr-kanban-col-body').forEach((body) => {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('drag-over');
      });
      body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const numero = e.dataTransfer.getData('text/plain') || draggingNumero;
        const status = body.closest('.arr-kanban-col')?.dataset.status;
        if (numero && status) await moveSpaceToStatus(numero, status);
      });
    });
  }

  function renderKanban() {
    if (!els.kanbanView) return;

    const etapas = spaceStatusEtapas();
    const numeros = filteredSpaceNumeros();

    const columns = etapas
      .map((etapa) => {
        const colItems = numeros.filter((n) => spaces[n]?.status === etapa.status);
        const total = colItems.reduce((sum, n) => {
          const v = valorNegociadoExibido(spaces, n, spaces[n]);
          return sum + (v != null ? Number(v) : 0);
        }, 0);
        return `
          <div class="arr-kanban-col" data-status="${escapeHtml(etapa.status)}">
            <header class="arr-kanban-col-head" style="--col-color:${escapeHtml(etapa.cor || statusColor(etapa.status))}">
              <span class="arr-kanban-col-title">${escapeHtml(etapa.titulo || statusLabel(etapa.status))}</span>
              <span class="arr-kanban-col-meta">${colItems.length} · ${fmtMoney(total)}</span>
            </header>
            <div class="arr-kanban-col-body">
              ${
                colItems.length
                  ? colItems.map((n) => renderKanbanCard(n)).join('')
                  : '<p class="arr-kanban-empty">Nenhum espaço</p>'
              }
            </div>
          </div>
        `;
      })
      .join('');

    els.kanbanView.innerHTML = columns;
    bindKanbanInteractions(els.kanbanView);
    renderReportSummary(numeros.length);
  }

  function renderAll() {
    const counts = { disp: 0, lead: 0, neg: 0, res: 0, vend: 0 };
    const numeros = spaceNumeros();

    renderMapPolygons();
    renderMapPolygonStyles();

    numeros.forEach((n) => {
      const data = spaces[n];
      counts[data.status] = (counts[data.status] || 0) + 1;
    });

    els.stTotal.textContent = numeros.length;
    els.stDisp.textContent = counts.disp || 0;
    if (els.stLead) els.stLead.textContent = counts.lead || 0;
    els.stNeg.textContent = counts.neg || 0;
    els.stRes.textContent = counts.res || 0;
    els.stVend.textContent = counts.vend || 0;

    renderStatusTotals();
    applyViewModeUi();
    if (viewMode === 'kanban') renderKanban();
    else renderTable();
    updateSelectionUi();
  }

  function renderStatusTotals() {
    if (!els.statusTotals) return;

    const totals = totalsByStatus();
    const rows = STATUS_ORDER.map((status) => {
      const data = totals[status];
      return `
        <div class="status-total-row">
          <div class="status-total-label">
            <span class="dot" style="background: ${statusColor(status)}"></span>
            ${statusLabel(status)}
          </div>
          <div class="status-total-val">${data.count}</div>
          <div class="status-total-val">${fmtMoney(data.custo)}</div>
          <div class="status-total-val">${data.valor > 0 ? fmtMoney(data.valor) : '—'}</div>
          <div class="status-total-val status-total-val--pago">${data.valorPago != null ? fmtMoney(data.valorPago) : '—'}</div>
          <div class="status-total-val status-total-val--falta">${data.valorFalta != null ? fmtMoney(data.valorFalta) : '—'}</div>
        </div>
      `;
    }).join('');

    const grandCount = STATUS_ORDER.reduce((sum, status) => sum + totals[status].count, 0);
    const grandCusto = totalCusto();
    const grandValor = totalNegociado();
    const grandPago = totalPago();
    const grandFalta = totalFalta();
    const custoEmpenhado = STATUS_ORDER.filter((s) => s !== 'disp').reduce(
      (sum, status) => sum + totals[status].custo,
      0,
    );
    const pctCusto = fmtPercent(custoEmpenhado, grandCusto);
    const pctValor = fmtPercent(grandValor, grandCusto);
    const pctPago = fmtPercent(grandPago, grandValor);

    const pctBlock = (pct, label) =>
      pct ? `<span class="status-total-pct">${pct} ${label}</span>` : '';

    els.statusTotals.innerHTML = `
      <div class="status-totals-head">Totais por status</div>
      <div class="status-totals-grid status-totals-grid-head">
        <div>Status</div>
        <div>Espaços</div>
        <div>Custo total</div>
        <div>Valor negociado</div>
        <div>Já pago</div>
        <div>Faltante</div>
      </div>
      ${rows}
      <div class="status-total-row grand-total">
        <div class="status-total-label">Total geral</div>
        <div class="status-total-val">${grandCount}</div>
        <div class="status-total-val">
          ${fmtMoney(grandCusto)}
          ${pctBlock(pctCusto, 'empenhado')}
        </div>
        <div class="status-total-val">
          ${grandValor > 0 ? fmtMoney(grandValor) : '—'}
          ${pctBlock(pctValor, 'da meta')}
        </div>
        <div class="status-total-val status-total-val--pago">
          ${grandValor > 0 || grandPago > 0 ? fmtMoney(grandPago) : '—'}
          ${pctBlock(pctPago, 'do negociado')}
        </div>
        <div class="status-total-val status-total-val--falta">
          ${grandValor > 0 || grandFalta > 0 ? fmtMoney(grandFalta) : '—'}
        </div>
      </div>
    `;
  }

  function renderReportSummary(displayedCount) {
    const reserved = Object.values(spaces).filter((s) => s.status === 'res').length;
    const occupied = Object.values(spaces).filter((s) => isActiveStatus(s.status)).length;
    const totalValor = totalNegociado();
    const totalPagoVal = totalPago();
    const totalFaltaVal = totalFalta();
    const custoTotal = totalCusto();
    const filterLabels = {
      all: 'Todos os espaços',
      active: 'Espaços ocupados (lead, negociação, reservados ou vendidos)',
      lead: 'Espaços em lead',
      res: 'Espaços reservados',
      neg: 'Espaços em negociação',
      vend: 'Espaços vendidos / fechados',
    };
    const pagoPart =
      totalValor > 0 || totalPagoVal > 0 ? ` · ${fmtMoney(totalPagoVal)} pago(s)` : '';
    const faltaPart =
      totalValor > 0 || totalFaltaVal > 0 ? ` · ${fmtMoney(totalFaltaVal)} faltante(s)` : '';
    const viewLabel = viewMode === 'kanban' ? 'Kanban' : 'Lista';
    els.reportSummary.textContent =
      `${viewLabel} · ${filterLabels[listFilter]}: ${displayedCount} exibido(s) · ${reserved} reservado(s) · ${occupied} ocupado(s) · ${fmtMoney(custoTotal)} em custos · ${fmtMoney(totalValor)} negociado(s)${pagoPart}${faltaPart}`;
  }

  function renderTable() {
    const rows = [];
    const numeros = filteredSpaceNumeros();

    for (const i of numeros) {
      const data = spaces[i];

      const tipo = data.tipo || '';
      const participante = data.participanteNome || '';
      const obs = data.obs || '';
      const groupNote = data.saleGroup
        ? ` <span class="cell-muted" title="Venda em grupo">· grupo</span>`
        : '';
      const valorExibido = valorNegociadoExibido(spaces, i, data);
      const pagamento = valoresPagamentoExibidos(spaces, i, data);
      const groupLeader = data.saleGroup ? saleGroupLeader(spaces, data.saleGroup) : null;
      const valorTitle =
        data.saleGroup && !isSaleGroupValorLeader(spaces, i, data)
          ? `Valor contado no Espaço ${groupLeader}`
          : '';

      rows.push(`
        <tr data-numero="${i}" class="${selectedNumeros.has(String(i)) ? 'selected-row' : ''}">
          <td class="chk-cell">
            <input class="chk row-chk" type="checkbox" ${selectedNumeros.has(String(i)) ? 'checked' : ''} data-numero="${i}">
          </td>
          <td><strong>${escapeHtml(spaceLabel(i))}</strong>${groupNote}</td>
          <td><span class="badge ${data.status}">${statusLabel(data.status)}</span></td>
          <td class="${tipo ? '' : 'cell-empty'}">${tipo ? escapeHtml(tipo) : '—'}</td>
          <td class="${participante ? '' : 'cell-empty'}">${participante ? escapeHtml(participante) : '—'}</td>
          <td class="cell-money ${data.custo != null ? '' : 'cell-empty'}">${fmtMoney(data.custo)}</td>
          <td class="cell-money ${valorExibido != null ? '' : 'cell-empty'}"${valorTitle ? ` title="${valorTitle}"` : ''}>${fmtMoney(valorExibido)}</td>
          <td class="cell-money cell-money--pago ${pagamento ? '' : 'cell-empty'}"${valorTitle ? ` title="${valorTitle}"` : ''}>${pagamento ? fmtMoney(pagamento.pago) : '—'}</td>
          <td class="cell-money cell-money--falta ${pagamento ? '' : 'cell-empty'}"${valorTitle ? ` title="${valorTitle}"` : ''}>${pagamento ? fmtMoney(pagamento.falta) : '—'}</td>
          <td class="${obs ? 'cell-muted' : 'cell-empty'}">${obs ? escapeHtml(obs) : '—'}</td>
          <td class="cell-muted">${fmtDate(data.updatedAt)}</td>
        </tr>
      `);
    }

    els.spacesTable.innerHTML =
      rows.join('') ||
      '<tr><td colspan="11" class="cell-empty">Nenhum espaço neste agrupamento ou filtro.</td></tr>';

    els.spacesTable.querySelectorAll('tr[data-numero]').forEach((row) => {
      row.addEventListener('click', () => openSpace(row.dataset.numero));
      const chk = row.querySelector('.row-chk');
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => toggleSelect(chk.dataset.numero, chk.checked));
    });

    renderReportSummary(rows.length);
  }

  function bindEvents() {
    document.getElementById('btn-continue').addEventListener('click', continueSelection);
    els.btnEditCusto?.addEventListener('click', openBulkCustoModal);
    document.getElementById('btn-clear-selection').addEventListener('click', clearSelection);
    els.chkAll.addEventListener('change', (e) => toggleSelectAll(e.target.checked));

    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    document.querySelectorAll('[data-esp-view]').forEach((btn) => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.espView));
    });

    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    els.btnClear.addEventListener('click', clearSpace);
    els.btnSave.addEventListener('click', saveSpace);

    els.modalBg.addEventListener('click', (event) => {
      if (event.target === els.modalBg) closeModal();
    });

    els.custoBtnCancel?.addEventListener('click', closeBulkCustoModal);
    els.custoBtnSave?.addEventListener('click', saveBulkCusto);
    els.custoModalBg?.addEventListener('click', (e) => {
      if (e.target === els.custoModalBg) closeBulkCustoModal();
    });
    els.bulkCusto?.addEventListener('input', (e) => maskValorInput(e.target));

    els.mCusto.addEventListener('input', (e) => maskValorInput(e.target));
    els.mValor.addEventListener('input', (e) => maskValorInput(e.target));
    els.mParticipante.addEventListener('input', syncParticipanteIdFromInput);
    els.mParticipante.addEventListener('change', syncParticipanteIdFromInput);

    els.btnExport.addEventListener('click', () => exportCSV(store));
    els.btnPrint.addEventListener('click', () => window.print());

    mapEditor.bindEvents();

    els.mapSvg.addEventListener('click', (e) => {
      const el = e.target.closest('polygon[data-numero], .map-space-label[data-numero]');
      if (!el) return;
      const numero = el.dataset.numero;
      if (mapEditor.isEditMode()) {
        if (mapEditor.selectSpace(numero)) {
          e.stopPropagation();
        }
        return;
      }
      toggleSelect(numero);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (mapEditor.isEditMode()) return;
      if (els.custoModalBg?.classList.contains('open')) closeBulkCustoModal();
      else if (els.modalBg.classList.contains('open')) closeModal();
    });
  }

  renderGrupoTabs();
  bindEvents();
  loadFunilEtapas();
  loadTiposComercio();
  renderParticipantesDatalist();
  setViewMode(viewMode);
  updateSyncStatus();

  return {
    renderAll,
    updateSyncStatus,
    renderGrupoTabs,
    renderParticipantesDatalist,
    reloadFunilEtapas: loadFunilEtapas,
  };
}
