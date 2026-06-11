import { COLORS, LABELS } from '../lib/constants.js';

const STATUS_ORDER = ['disp', 'neg', 'res', 'vend'];
import { defaultSpace } from '../lib/store.js';
import { fetchTiposComercio } from '../lib/api.js';
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
} from '../lib/format.js';
import { exportCSV } from './export.js';

export function initSpacesModule(store) {
  const {
    spaces,
    persist,
    isActiveStatus,
    totalNegociado,
    totalCusto,
    totalsByStatus,
    spaceNumeros,
    switchGrupo,
  } = store;

  let editNumeros = [];
  let listFilter = 'all';
  const selectedNumeros = new Set();
  const els = {
    grupoTabs: document.getElementById('grupo-tabs'),
    grupoTitle: document.getElementById('grupo-title'),
    stTotal: document.getElementById('st-total'),
    stDisp: document.getElementById('st-disp'),
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
    els.mapSvg.setAttribute('viewBox', `0 0 ${grupo.mapWidth} ${grupo.mapHeight}`);
  }

  function renderMapPolygons() {
    updateMapLayout();
    if (!hasSpaces() || !store.currentGrupo?.mapImage) {
      els.mapSvg.innerHTML = '';
      return;
    }

    const numeros = [...spaceNumeros()].sort((a, b) => b - a);
    els.mapSvg.innerHTML = numeros
      .filter((n) => spaces[n]?.points)
      .map(
        (n) =>
          `<polygon data-numero="${n}" data-lbl="${escapeHtml(spaceLabel(n))}" points="${spaces[n].points}"></polygon>`,
      )
      .join('');

    document.querySelectorAll('#map-svg polygon').forEach((poly) => {
      poly.addEventListener('click', () => toggleSelect(poly.dataset.numero));
    });
  }

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

  function fillModalForm(data, isBulk) {
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
    renderTable();
  }

  function openSpaces(numeros) {
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

    els.modalBg.classList.add('open');
  }

  function openSpace(numero) {
    clearSelection();
    openSpaces([numero]);
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    editNumeros = [];
  }

  async function saveSpace() {
    if (!editNumeros.length) return;
    const isBulk = editNumeros.length > 1;
    const form = readModalForm(isBulk);
    const now = new Date().toISOString();
    const saleGroup = isBulk ? `grupo-${store.currentGrupo.slug}-${Date.now()}` : '';
    const updates = buildSaveUpdates(isBulk, form, saleGroup, now);

    els.btnSave.disabled = true;
    updateSyncStatus();
    try {
      await persist(null, updates);
      renderTiposComercio();
      renderParticipantesDatalist();
      renderAll();
      clearSelection();
      closeModal();
    } catch (err) {
      renderAll();
      alert(err.message || 'Falha ao salvar o espaço');
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

  function renderAll() {
    const counts = { disp: 0, neg: 0, res: 0, vend: 0 };
    const numeros = spaceNumeros();

    renderMapPolygons();

    document.querySelectorAll('#map-svg polygon').forEach((poly) => {
      const numero = poly.dataset.numero;
      const data = spaces[numero];
      const color = COLORS[data.status] || COLORS.disp;
      poly.setAttribute('fill', color);
      poly.setAttribute('fill-opacity', '0.55');
      counts[data.status] = (counts[data.status] || 0) + 1;
    });

    els.stTotal.textContent = numeros.length;
    els.stDisp.textContent = counts.disp || 0;
    els.stNeg.textContent = counts.neg || 0;
    els.stRes.textContent = counts.res || 0;
    els.stVend.textContent = counts.vend || 0;

    renderStatusTotals();
    renderTable();
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
            <span class="dot" style="background: ${COLORS[status]}"></span>
            ${LABELS[status]}
          </div>
          <div class="status-total-val">${data.count}</div>
          <div class="status-total-val">${fmtMoney(data.custo)}</div>
          <div class="status-total-val">${data.valor > 0 ? fmtMoney(data.valor) : '—'}</div>
        </div>
      `;
    }).join('');

    const grandCount = STATUS_ORDER.reduce((sum, status) => sum + totals[status].count, 0);
    const grandCusto = totalCusto();
    const grandValor = totalNegociado();
    const custoEmpenhado = STATUS_ORDER.filter((s) => s !== 'disp').reduce(
      (sum, status) => sum + totals[status].custo,
      0,
    );
    const pctCusto = fmtPercent(custoEmpenhado, grandCusto);
    const pctValor = fmtPercent(grandValor, grandCusto);

    const pctBlock = (pct, label) =>
      pct ? `<span class="status-total-pct">${pct} ${label}</span>` : '';

    els.statusTotals.innerHTML = `
      <div class="status-totals-head">Totais por status</div>
      <div class="status-totals-grid status-totals-grid-head">
        <div>Status</div>
        <div>Espaços</div>
        <div>Custo total</div>
        <div>Valor negociado</div>
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
      </div>
    `;
  }

  function renderTable() {
    const rows = [];
    const numeros = spaceNumeros();

    for (const i of numeros) {
      const data = spaces[i];
      if (listFilter === 'active' && !isActiveStatus(data.status)) continue;
      if (listFilter !== 'all' && listFilter !== 'active' && data.status !== listFilter) continue;

      const tipo = data.tipo || '';
      const participante = data.participanteNome || '';
      const obs = data.obs || '';
      const groupNote = data.saleGroup
        ? ` <span class="cell-muted" title="Venda em grupo">· grupo</span>`
        : '';
      const valorExibido = valorNegociadoExibido(spaces, i, data);
      const valorTitle =
        data.saleGroup && !isSaleGroupValorLeader(spaces, i, data)
          ? `Valor contado no Espaço ${saleGroupLeader(spaces, data.saleGroup)}`
          : '';

      rows.push(`
        <tr data-numero="${i}" class="${selectedNumeros.has(String(i)) ? 'selected-row' : ''}">
          <td class="chk-cell">
            <input class="chk row-chk" type="checkbox" ${selectedNumeros.has(String(i)) ? 'checked' : ''} data-numero="${i}">
          </td>
          <td><strong>${escapeHtml(spaceLabel(i))}</strong>${groupNote}</td>
          <td><span class="badge ${data.status}">${LABELS[data.status]}</span></td>
          <td class="${tipo ? '' : 'cell-empty'}">${tipo ? escapeHtml(tipo) : '—'}</td>
          <td class="${participante ? '' : 'cell-empty'}">${participante ? escapeHtml(participante) : '—'}</td>
          <td class="cell-money ${data.custo != null ? '' : 'cell-empty'}">${fmtMoney(data.custo)}</td>
          <td class="cell-money ${valorExibido != null ? '' : 'cell-empty'}"${valorTitle ? ` title="${valorTitle}"` : ''}>${fmtMoney(valorExibido)}</td>
          <td class="${obs ? 'cell-muted' : 'cell-empty'}">${obs ? escapeHtml(obs) : '—'}</td>
          <td class="cell-muted">${fmtDate(data.updatedAt)}</td>
        </tr>
      `);
    }

    els.spacesTable.innerHTML =
      rows.join('') ||
      '<tr><td colspan="9" class="cell-empty">Nenhum espaço neste agrupamento ou filtro.</td></tr>';

    els.spacesTable.querySelectorAll('tr[data-numero]').forEach((row) => {
      row.addEventListener('click', () => openSpace(row.dataset.numero));
      const chk = row.querySelector('.row-chk');
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => toggleSelect(chk.dataset.numero, chk.checked));
    });

    const reserved = Object.values(spaces).filter((s) => s.status === 'res').length;
    const occupied = Object.values(spaces).filter((s) => isActiveStatus(s.status)).length;
    const totalValor = totalNegociado();
    const custoTotal = totalCusto();
    const filterLabels = {
      all: 'Todos os espaços',
      active: 'Espaços ocupados (negociação, reservados ou vendidos)',
      res: 'Espaços reservados',
      neg: 'Espaços em negociação',
      vend: 'Espaços vendidos / fechados',
    };
    els.reportSummary.textContent =
      `${filterLabels[listFilter]}: ${rows.length} exibido(s) · ${reserved} reservado(s) · ${occupied} ocupado(s) · ${fmtMoney(custoTotal)} em custos · ${fmtMoney(totalValor)} negociado(s)`;
  }

  function bindEvents() {
    document.getElementById('btn-continue').addEventListener('click', continueSelection);
    els.btnEditCusto?.addEventListener('click', openBulkCustoModal);
    document.getElementById('btn-clear-selection').addEventListener('click', clearSelection);
    els.chkAll.addEventListener('change', (e) => toggleSelectAll(e.target.checked));

    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
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

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.custoModalBg?.classList.contains('open')) closeBulkCustoModal();
      else if (els.modalBg.classList.contains('open')) closeModal();
    });
  }

  renderGrupoTabs();
  bindEvents();
  loadTiposComercio();
  renderParticipantesDatalist();
  updateSyncStatus();

  return { renderAll, updateSyncStatus, renderGrupoTabs, renderParticipantesDatalist };
}
