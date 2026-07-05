import {
  fetchMarketing,
  fetchGrupos,
  fetchGrupoSpaces,
  createMarketingCanal,
  updateMarketingCanal,
  deleteMarketingCanal,
  createMarketingCampanha,
  updateMarketingCampanha,
  deleteMarketingCampanha,
  createMarketingCriativo,
  updateMarketingCriativo,
  deleteMarketingCriativo,
  previewMarketingComunicacao,
  enviarMarketingComunicacaoItem,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { initMarketingFormularios } from './marketing-formularios.js';

function normalizeInstagramHandle(value) {
  const handle = String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .split('/')[0];
  if (!handle) return '';
  return `@${handle}`;
}

function instagramHandleKey(value) {
  return normalizeInstagramHandle(value).slice(1).toLowerCase();
}

async function collectInstagramMentionsFromEspacos() {
  const { grupos = [] } = await fetchGrupos();
  if (!grupos.length) return [];

  const gruposData = await Promise.all(grupos.map((g) => fetchGrupoSpaces(g.slug)));
  const participanteById = new Map();

  for (const data of gruposData) {
    for (const p of data.participantes || []) {
      participanteById.set(p.id, p);
    }
  }

  const handles = new Map();
  for (const data of gruposData) {
    for (const space of Object.values(data.spaces || {})) {
      if (!space?.participanteId) continue;
      const participante = participanteById.get(space.participanteId);
      const mention = normalizeInstagramHandle(participante?.instagram);
      if (!mention) continue;
      const key = instagramHandleKey(mention);
      if (!handles.has(key)) handles.set(key, mention);
    }
  }

  return [...handles.values()].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  );
}

function getCampanhaOrigemIds(campanha) {
  if (campanha?.canalIds?.length) return campanha.canalIds;
  if (campanha?.canalId) return [campanha.canalId];
  return [];
}

function campanhaHasOrigem(campanha, origemId) {
  if (!origemId) return true;
  return getCampanhaOrigemIds(campanha).includes(Number(origemId));
}

function criativoHasOrigem(criativo, origemId) {
  if (!origemId) return true;
  const ids = criativo?.canalIds?.length
    ? criativo.canalIds
    : criativo?.canalId
      ? [criativo.canalId]
      : [];
  return ids.includes(Number(origemId));
}

function sameIdSet(a, b) {
  const sa = [...new Set(a.map(Number))].sort((x, y) => x - y);
  const sb = [...new Set(b.map(Number))].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((id, i) => id === sb[i]);
}

function formatOrigensLabel(item) {
  if (item?.canalNomes?.length) return item.canalNomes.join(' · ');
  return item?.canalNome || '—';
}

function formatCriativoOrigensLabel(criativo) {
  const label = formatOrigensLabel(criativo);
  if (criativo?.origensDaCampanha && label !== '—') {
    return `${label} (da campanha)`;
  }
  return label;
}

export function initMarketingModule() {
  const els = {
    summary: document.getElementById('marketing-summary'),
    tabs: document.getElementById('marketing-tabs'),
    panelInicio: document.getElementById('marketing-panel-inicio'),
    panelCanais: document.getElementById('marketing-panel-canais'),
    panelCampanhas: document.getElementById('marketing-panel-campanhas'),
    panelCriativos: document.getElementById('marketing-panel-criativos'),
    panelFormularios: document.getElementById('marketing-panel-formularios'),
    btnIgGenerate: document.getElementById('btn-marketing-ig-generate'),
    igOutput: document.getElementById('marketing-ig-output'),
    igResult: document.getElementById('marketing-ig-result'),
    igMeta: document.getElementById('marketing-ig-meta'),
    btnIgCopy: document.getElementById('btn-marketing-ig-copy'),
    comFilters: document.getElementById('marketing-com-filters'),
    comTemplate: document.getElementById('marketing-com-template'),
    comIntervalMin: document.getElementById('marketing-com-interval-min'),
    comIntervalMax: document.getElementById('marketing-com-interval-max'),
    btnComPreview: document.getElementById('btn-marketing-com-preview'),
    comPreview: document.getElementById('marketing-com-preview'),
    comMeta: document.getElementById('marketing-com-meta'),
    comTable: document.getElementById('marketing-com-table'),
    btnComStart: document.getElementById('btn-marketing-com-start'),
    btnComPause: document.getElementById('btn-marketing-com-pause'),
    comProgress: document.getElementById('marketing-com-progress'),
    comErrors: document.getElementById('marketing-com-errors'),
    tableCanais: document.getElementById('marketing-table-canais'),
    tableCampanhas: document.getElementById('marketing-table-campanhas'),
    tableCriativos: document.getElementById('marketing-table-criativos'),
    btnNewCanal: document.getElementById('btn-marketing-canal-new'),
    btnNewCampanha: document.getElementById('btn-marketing-campanha-new'),
    btnNewCriativo: document.getElementById('btn-marketing-criativo-new'),
    modalBg: document.getElementById('marketing-modal-bg'),
    modalTitle: document.getElementById('marketing-modal-title'),
    modalSub: document.getElementById('marketing-modal-sub'),
    fieldNome: document.getElementById('marketing-modal-nome'),
    fieldCanal: document.getElementById('marketing-modal-canal'),
    fieldCampanha: document.getElementById('marketing-modal-campanha'),
    fieldCanalWrap: document.getElementById('marketing-modal-canal-wrap'),
    fieldOrigensWrap: document.getElementById('marketing-modal-origens-wrap'),
    fieldOrigens: document.getElementById('marketing-modal-origens'),
    fieldOrigensHint: document.getElementById('marketing-modal-origens-hint'),
    fieldCampanhaWrap: document.getElementById('marketing-modal-campanha-wrap'),
    btnCancel: document.getElementById('marketing-modal-cancel'),
    btnSave: document.getElementById('marketing-modal-save'),
    btnDelete: document.getElementById('marketing-modal-delete'),
  };

  let data = { canais: [], campanhas: [], criativos: [] };
  let activeTab = 'inicio';
  let editKind = null;
  let editId = null;
  let comQueue = [];
  let comDispatching = false;
  let comPaused = false;
  let comSent = 0;
  let comAbort = false;

  const formulariosModule = initMarketingFormularios({
    getMarketingData: () => data,
    onSummaryChange: (text) => {
      if (activeTab === 'formularios' && els.summary) els.summary.textContent = text;
    },
  });

  function setTab(tab) {
    activeTab = tab;
    els.tabs?.querySelectorAll('[data-marketing-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.marketingTab === tab);
    });
    els.panelInicio?.classList.toggle('hidden', tab !== 'inicio');
    els.panelCanais?.classList.toggle('hidden', tab !== 'canais');
    els.panelCampanhas?.classList.toggle('hidden', tab !== 'campanhas');
    els.panelCriativos?.classList.toggle('hidden', tab !== 'criativos');
    formulariosModule.showPanel(tab === 'formularios');
  }

  function getCampanhaById(id) {
    return data.campanhas.find((c) => c.id === Number(id)) || null;
  }

  function renderCanalFilterOptions(selectedId = null) {
    if (!els.fieldCanal) return;
    const current = selectedId != null ? String(selectedId) : '';
    els.fieldCanal.innerHTML =
      '<option value="">Todas</option>' +
      data.canais
        .filter((c) => c.ativo)
        .map(
          (c) =>
            `<option value="${c.id}"${String(c.id) === current ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
        )
        .join('');
  }

  function renderOrigemCheckboxes(selectedIds = [], { emptyMessage } = {}) {
    if (!els.fieldOrigens) return;
    const selected = new Set(selectedIds.map((id) => Number(id)));
    const ativos = data.canais.filter((c) => c.ativo);
    if (!ativos.length) {
      els.fieldOrigens.innerHTML =
        `<p class="cell-empty">${emptyMessage || 'Cadastre origens antes de continuar.'}</p>`;
      return;
    }
    els.fieldOrigens.innerHTML = ativos
      .map(
        (c) => `
        <label class="marketing-origem-check">
          <input type="checkbox" value="${c.id}"${selected.has(c.id) ? ' checked' : ''} />
          <span>${escapeHtml(c.nome)}</span>
        </label>`,
      )
      .join('');
  }

  function getSelectedOrigemIds() {
    if (!els.fieldOrigens) return [];
    return [...els.fieldOrigens.querySelectorAll('input[type="checkbox"]:checked')].map((el) =>
      Number(el.value),
    );
  }

  function getCriativoOrigemIdsForForm(criativo, campanhaId) {
    if (criativo && !criativo.origensDaCampanha && criativo.canalIdsProprios?.length) {
      return criativo.canalIdsProprios;
    }
    return getCampanhaOrigemIds(getCampanhaById(campanhaId));
  }

  function renderCriativoOrigens(campanhaId, criativo = null) {
    const ids = getCriativoOrigemIdsForForm(criativo, campanhaId);
    renderOrigemCheckboxes(ids, {
      emptyMessage: 'Selecione uma campanha com origens cadastradas.',
    });
    if (els.fieldOrigensHint) {
      els.fieldOrigensHint.textContent = campanhaId
        ? 'Por padrão, usa as origens da campanha. Altere para definir origens específicas deste criativo.'
        : 'Selecione a campanha para carregar as origens padrão.';
    }
  }

  function renderCampanhaOptions(origemFiltro = null, selectedId = null) {
    if (!els.fieldCampanha) return;
    const current = selectedId != null ? String(selectedId) : '';
    const list = data.campanhas.filter(
      (c) => c.ativo && campanhaHasOrigem(c, origemFiltro ? Number(origemFiltro) : null),
    );
    els.fieldCampanha.innerHTML =
      '<option value="">Selecione</option>' +
      list
        .map(
          (c) =>
            `<option value="${c.id}"${String(c.id) === current ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
        )
        .join('');
  }

  function bindTableActions() {
    const root = document.getElementById('view-marketing');
    if (!root) return;

    root.querySelectorAll('[data-action="edit-canal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = data.canais.find((c) => c.id === Number(btn.dataset.id));
        if (item) openModal('canal', item);
      });
    });
    root.querySelectorAll('[data-action="delete-canal"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteItem('canal', Number(btn.dataset.id)));
    });
    root.querySelectorAll('[data-action="edit-campanha"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = data.campanhas.find((c) => c.id === Number(btn.dataset.id));
        if (item) openModal('campanha', item);
      });
    });
    root.querySelectorAll('[data-action="delete-campanha"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteItem('campanha', Number(btn.dataset.id)));
    });
    root.querySelectorAll('[data-action="edit-criativo"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = data.criativos.find((c) => c.id === Number(btn.dataset.id));
        if (item) openModal('criativo', item);
      });
    });
    root.querySelectorAll('[data-action="delete-criativo"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteItem('criativo', Number(btn.dataset.id)));
    });
  }

  function renderTables() {
    const { canais, campanhas, criativos } = data;

    if (els.tableCanais) {
      els.tableCanais.innerHTML = canais.length
        ? canais
            .map(
              (c) => `
          <tr data-id="${c.id}">
            <td><strong>${escapeHtml(c.nome)}</strong></td>
            <td>${c.ativo ? 'Ativo' : 'Inativo'}</td>
            <td class="row-actions">
              <button class="tbtn" type="button" data-action="edit-canal" data-id="${c.id}">Editar</button>
              <button class="tbtn danger-text" type="button" data-action="delete-canal" data-id="${c.id}">Excluir</button>
            </td>
          </tr>`,
            )
            .join('')
        : '<tr><td colspan="3" class="cell-empty">Nenhuma origem cadastrada.</td></tr>';
    }

    if (els.tableCampanhas) {
      els.tableCampanhas.innerHTML = campanhas.length
        ? campanhas
            .map(
              (c) => `
          <tr data-id="${c.id}">
            <td><strong>${escapeHtml(c.nome)}</strong></td>
            <td>${escapeHtml(formatOrigensLabel(c))}</td>
            <td>${c.ativo ? 'Ativo' : 'Inativo'}</td>
            <td class="row-actions">
              <button class="tbtn" type="button" data-action="edit-campanha" data-id="${c.id}">Editar</button>
              <button class="tbtn danger-text" type="button" data-action="delete-campanha" data-id="${c.id}">Excluir</button>
            </td>
          </tr>`,
            )
            .join('')
        : '<tr><td colspan="4" class="cell-empty">Nenhuma campanha cadastrada.</td></tr>';
    }

    if (els.tableCriativos) {
      els.tableCriativos.innerHTML = criativos.length
        ? criativos
            .map(
              (c) => `
          <tr data-id="${c.id}">
            <td><strong>${escapeHtml(c.nome)}</strong></td>
            <td>${escapeHtml(c.campanhaNome || '—')}</td>
            <td>${escapeHtml(formatCriativoOrigensLabel(c))}</td>
            <td>${c.ativo ? 'Ativo' : 'Inativo'}</td>
            <td class="row-actions">
              <button class="tbtn" type="button" data-action="edit-criativo" data-id="${c.id}">Editar</button>
              <button class="tbtn danger-text" type="button" data-action="delete-criativo" data-id="${c.id}">Excluir</button>
            </td>
          </tr>`,
            )
            .join('')
        : '<tr><td colspan="5" class="cell-empty">Nenhum criativo cadastrado.</td></tr>';
    }

    if (els.summary) {
      if (activeTab === 'inicio') {
        els.summary.textContent = 'Ferramentas para agilizar postagens e acompanhar origens de leads.';
      } else if (activeTab === 'formularios') {
        formulariosModule.renderTable();
      } else {
        els.summary.textContent = `${canais.length} origem(ns) · ${campanhas.length} campanha(s) · ${criativos.length} criativo(s)`;
      }
    }

    bindTableActions();
  }

  async function generateInstagramList() {
    if (!els.btnIgGenerate || !els.igResult) return;
    els.btnIgGenerate.disabled = true;
    const prevLabel = els.btnIgGenerate.textContent;
    els.btnIgGenerate.textContent = 'Gerando…';
    if (els.igMeta) els.igMeta.textContent = '';

    try {
      const mentions = await collectInstagramMentionsFromEspacos();
      const text = mentions.join(' ');
      els.igResult.value = text;
      els.igOutput?.classList.remove('hidden');
      if (els.igMeta) {
        els.igMeta.textContent = mentions.length
          ? `${mentions.length} perfil(is) · evento atual`
          : 'Nenhum espaço com Instagram cadastrado no evento.';
      }
    } catch (err) {
      alert(err.message || 'Não foi possível gerar a lista.');
    } finally {
      els.btnIgGenerate.disabled = false;
      els.btnIgGenerate.textContent = prevLabel;
    }
  }

  async function copyInstagramList() {
    const text = els.igResult?.value?.trim() || '';
    if (!text) {
      alert('Gere a lista antes de copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (els.btnIgCopy) {
        const prev = els.btnIgCopy.textContent;
        els.btnIgCopy.textContent = 'Copiado!';
        setTimeout(() => {
          if (els.btnIgCopy) els.btnIgCopy.textContent = prev;
        }, 1600);
      }
    } catch (_) {
      els.igResult?.select();
      document.execCommand('copy');
    }
  }

  function getSelectedComTipos() {
    if (!els.comFilters) return [];
    return [...els.comFilters.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
  }

  function getComIntervalBounds() {
    let min = Number(els.comIntervalMin?.value) || 15;
    let max = Number(els.comIntervalMax?.value) || 45;
    min = Math.min(Math.max(min, 5), 600);
    max = Math.min(Math.max(max, 5), 600);
    if (min > max) [min, max] = [max, min];
    return { min, max };
  }

  function randomDelayMs(minSec, maxSec) {
    const sec = minSec + Math.random() * (maxSec - minSec);
    return Math.round(sec * 1000);
  }

  function updateComProgressUI() {
    const total = comQueue.length;
    if (els.comProgress) {
      els.comProgress.textContent = total
        ? `${comSent} de ${total} enviado(s)${comPaused ? ' · pausado' : comDispatching ? ' · enviando…' : ''}`
        : '';
    }
    els.btnComStart?.classList.toggle('hidden', comDispatching && !comPaused);
    els.btnComPause?.classList.toggle('hidden', !comDispatching || comPaused);
    if (els.btnComStart && !comDispatching) {
      els.btnComStart.disabled = !comQueue.length;
      els.btnComStart.textContent = comSent > 0 && comSent < total ? 'Retomar disparo' : 'Iniciar disparo';
    }
  }

  function appendComError(msg) {
    if (!els.comErrors) return;
    els.comErrors.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = msg;
    els.comErrors.appendChild(li);
  }

  function renderComPreviewTable(items) {
    if (!els.comTable) return;
    els.comTable.innerHTML = items.length
      ? items
          .map(
            (item) => `
        <tr>
          <td><strong>${escapeHtml(item.nome)}</strong></td>
          <td>${escapeHtml(item.telefone)}</td>
          <td>${escapeHtml(item.tipoLabel || item.tipo)}</td>
          <td>${escapeHtml(item.mensagem)}</td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="cell-empty">Nenhum contato com WhatsApp nos filtros selecionados.</td></tr>';
  }

  async function generateComunicacaoPreview() {
    const tipos = getSelectedComTipos();
    if (!tipos.length) {
      alert('Selecione ao menos um tipo de lead.');
      return;
    }
    const template = els.comTemplate?.value?.trim() || '';
    if (!template) {
      alert('Informe o template da mensagem.');
      return;
    }

    els.btnComPreview.disabled = true;
    const prevLabel = els.btnComPreview.textContent;
    els.btnComPreview.textContent = 'Gerando…';
    comAbort = true;
    comDispatching = false;
    comPaused = false;
    comSent = 0;
    comQueue = [];
    if (els.comErrors) {
      els.comErrors.innerHTML = '';
      els.comErrors.classList.add('hidden');
    }

    try {
      const data = await previewMarketingComunicacao({ template, tipos });
      comQueue = data.items || [];
      renderComPreviewTable(comQueue);
      els.comPreview?.classList.remove('hidden');
      if (els.comMeta) {
        els.comMeta.textContent = comQueue.length
          ? `${comQueue.length} destinatário(s) · tipos: ${(data.tipos || tipos).join(', ')}`
          : 'Nenhum contato encontrado com telefone válido.';
      }
      updateComProgressUI();
    } catch (err) {
      alert(err.message || 'Não foi possível gerar a lista.');
    } finally {
      els.btnComPreview.disabled = false;
      els.btnComPreview.textContent = prevLabel;
    }
  }

  async function runComunicacaoDispatch() {
    if (!comQueue.length || comDispatching) return;

    const pending = comQueue.slice(comSent);
    if (!pending.length) {
      alert('Todos os envios desta lista já foram concluídos. Gere a lista novamente para um novo disparo.');
      return;
    }

    const total = comQueue.length;
    const confirmMsg = `Enviar WhatsApp para ${pending.length} contato(s)?\n\nIntervalo aleatório entre envios para reduzir risco de bloqueio.`;
    if (!confirm(confirmMsg)) return;

    comDispatching = true;
    comPaused = false;
    comAbort = false;
    updateComProgressUI();

    const { min, max } = getComIntervalBounds();

    for (let i = comSent; i < comQueue.length; i += 1) {
      if (comAbort || comPaused) break;

      const item = comQueue[i];
      try {
        await enviarMarketingComunicacaoItem({
          arrecadacaoId: item.arrecadacaoId,
          texto: item.mensagem,
        });
        comSent += 1;
        updateComProgressUI();
      } catch (err) {
        appendComError(`${item.nome}: ${err.message || 'falha no envio'}`);
      }

      if (comAbort || comPaused || i >= comQueue.length - 1) break;
      await new Promise((resolve) => setTimeout(resolve, randomDelayMs(min, max)));
    }

    comDispatching = false;
    updateComProgressUI();

    if (!comPaused && comSent >= total && els.comProgress) {
      els.comProgress.textContent = `Concluído: ${comSent} de ${total} enviado(s).`;
    }
  }

  function pauseComunicacaoDispatch() {
    if (!comDispatching) return;
    comPaused = true;
    comAbort = true;
    comDispatching = false;
    updateComProgressUI();
  }

  function openModal(kind, item = null) {
    editKind = kind;
    editId = item?.id ?? null;
    const isEdit = editId != null;

    const titles = { canal: 'Origem', campanha: 'Campanha', criativo: 'Criativo (mídia)' };
    els.modalTitle.textContent = isEdit ? `Editar ${titles[kind]}` : `Nova ${titles[kind]}`;
    els.modalSub.textContent = isEdit
      ? `Alterando “${item.nome}”`
      : 'Cadastre origens, campanhas e criativos para rastrear de onde vêm os leads.';

    const isCriativo = kind === 'criativo';
    const isCampanha = kind === 'campanha';

    els.fieldCanalWrap?.classList.toggle('hidden', !isCriativo);
    els.fieldOrigensWrap?.classList.toggle('hidden', !isCampanha && !isCriativo);
    els.fieldCampanhaWrap?.classList.toggle('hidden', !isCriativo);

    if (els.fieldNome) {
      els.fieldNome.value = item?.nome || '';
      els.fieldNome.placeholder =
        kind === 'canal' ? 'Ex.: Instagram' : kind === 'campanha' ? 'Ex.: Verão 2026' : 'Ex.: Story promo';
    }

    if (isCampanha) {
      renderOrigemCheckboxes(getCampanhaOrigemIds(item), {
        emptyMessage: 'Cadastre origens antes de vincular à campanha.',
      });
      if (els.fieldOrigensHint) {
        els.fieldOrigensHint.textContent = 'Uma campanha pode ocorrer em mais de uma origem.';
      }
    }

    if (isCriativo) {
      renderCanalFilterOptions();
      renderCampanhaOptions(null, item?.campanhaId);
      const campanhaId = item?.campanhaId || Number(els.fieldCampanha?.value) || null;
      if (els.fieldCampanha && campanhaId) {
        els.fieldCampanha.value = String(campanhaId);
      }
      renderCriativoOrigens(campanhaId, item);
    }

    els.btnDelete?.classList.toggle('hidden', !isEdit);
    els.modalBg?.classList.add('open');
    els.fieldNome?.focus();
  }

  function closeModal() {
    els.modalBg?.classList.remove('open');
    editKind = null;
    editId = null;
  }

  async function saveModal() {
    const nome = els.fieldNome?.value.trim() || '';
    if (!nome) {
      alert('Informe o nome.');
      return;
    }

    let canalIds = [];
    let usarOrigensCampanha = false;
    let campanhaId = null;

    if (editKind === 'campanha' || editKind === 'criativo') {
      canalIds = getSelectedOrigemIds();
      if (!canalIds.length) {
        alert('Selecione ao menos uma origem.');
        return;
      }
    }

    if (editKind === 'criativo') {
      campanhaId = Number(els.fieldCampanha?.value);
      if (!campanhaId) {
        alert('Selecione a campanha.');
        return;
      }
      const campanhaIds = getCampanhaOrigemIds(getCampanhaById(campanhaId));
      usarOrigensCampanha = sameIdSet(canalIds, campanhaIds);
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      if (editKind === 'canal') {
        if (editId) await updateMarketingCanal(editId, { nome });
        else await createMarketingCanal({ nome });
      } else if (editKind === 'campanha') {
        if (editId) await updateMarketingCampanha(editId, { nome, canalIds });
        else await createMarketingCampanha({ nome, canalIds });
      } else if (editKind === 'criativo') {
        const payload = { nome, campanhaId, canalIds, usarOrigensCampanha };
        if (editId) await updateMarketingCriativo(editId, payload);
        else await createMarketingCriativo(payload);
      }
      closeModal();
      await loadMarketing();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  async function deleteItem(kind, id) {
    const labels = { canal: 'origem', campanha: 'campanha', criativo: 'criativo' };
    if (!confirm(`Excluir esta ${labels[kind]}? Leads vinculados perderão essa referência.`)) return;
    try {
      if (kind === 'canal') await deleteMarketingCanal(id);
      else if (kind === 'campanha') await deleteMarketingCampanha(id);
      else await deleteMarketingCriativo(id);
      await loadMarketing();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadMarketing() {
    data = await fetchMarketing();
    data.canais = data.canais || [];
    data.campanhas = data.campanhas || [];
    data.criativos = data.criativos || [];
    renderTables();
  }

  els.tabs?.querySelectorAll('[data-marketing-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTab(btn.dataset.marketingTab);
      renderTables();
    });
  });
  els.btnIgGenerate?.addEventListener('click', () => void generateInstagramList());
  els.btnIgCopy?.addEventListener('click', () => void copyInstagramList());
  els.btnComPreview?.addEventListener('click', () => void generateComunicacaoPreview());
  els.btnComStart?.addEventListener('click', () => void runComunicacaoDispatch());
  els.btnComPause?.addEventListener('click', pauseComunicacaoDispatch);
  els.btnNewCanal?.addEventListener('click', () => openModal('canal'));
  els.btnNewCampanha?.addEventListener('click', () => openModal('campanha'));
  els.btnNewCriativo?.addEventListener('click', () => openModal('criativo'));
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', saveModal);
  els.btnDelete?.addEventListener('click', () => {
    if (editId && editKind) deleteItem(editKind, editId).then(closeModal);
  });
  els.fieldCanal?.addEventListener('change', () => {
    if (editKind === 'criativo') {
      renderCampanhaOptions(Number(els.fieldCanal?.value) || null);
      renderCriativoOrigens(Number(els.fieldCampanha?.value) || null);
    }
  });
  els.fieldCampanha?.addEventListener('change', () => {
    if (editKind === 'criativo') {
      renderCriativoOrigens(Number(els.fieldCampanha?.value) || null);
    }
  });
  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  setTab('inicio');
  renderTables();

  return { loadMarketing, getMarketingData: () => data };
}

export { campanhaHasOrigem, criativoHasOrigem, getCampanhaOrigemIds };
