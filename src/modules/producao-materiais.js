import {
  fetchProducaoMateriaisLotes,
  fetchProducaoMateriaisLote,
  createProducaoMateriaisLote,
  updateProducaoMateriaisLote,
  deleteProducaoMateriaisLote,
  importarEntregasProducaoMateriaisLote,
  createProducaoMateriaisItem,
  updateProducaoMateriaisItem,
  deleteProducaoMateriaisItem,
  duplicateProducaoMateriaisItem,
  moveProducaoMateriaisItem,
  fetchProducaoMateriaisPedidoTexto,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';

const DEFAULT_CATEGORIAS = [
  { key: 'camiseta', label: 'Camiseta' },
  { key: 'lona', label: 'Lona / banner' },
  { key: 'adesivo', label: 'Adesivo' },
  { key: 'impressao_3d', label: 'Impressão 3D' },
  { key: 'textil', label: 'Têxtil / costura' },
  { key: 'sinalizacao', label: 'Sinalização' },
  { key: 'brinde', label: 'Brinde / kit' },
  { key: 'outro', label: 'Outro' },
];

const DEFAULT_UNIDADES = ['un', 'm²', 'm', 'par', 'kit', 'rolo', 'folha'];

const DEFAULT_CAMISETA_TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', '3G'];

const DEFAULT_LOTE_STATUS_OPCOES = [
  { key: 'em_criacao', label: 'Em criação' },
  { key: 'enviado_orcamento', label: 'Enviado para orçamento' },
  { key: 'orcamento_aprovado', label: 'Orçamento aprovado' },
  { key: 'em_producao', label: 'Em produção' },
  { key: 'em_entrega', label: 'Em entrega' },
];

function origemLabel(origem) {
  if (origem === 'entregas') return 'Entregas';
  return 'Manual';
}

function formatAtributos(atributos) {
  const a = atributos && typeof atributos === 'object' ? atributos : {};
  const parts = [];
  if (a.material) parts.push(`Material: ${a.material}`);
  if (a.cor) parts.push(`Cor: ${a.cor}`);
  if (a.dimensoes) parts.push(a.dimensoes);
  if (a.observacao) parts.push(a.observacao);
  if (a.plano) parts.push(`Plano: ${a.plano}`);
  if (a.ingresso) parts.push(`Ingresso ${a.ingresso}`);
  return parts.length ? parts.join(' · ') : '—';
}

function itemEspecificacao(item) {
  const t = String(item.tamanho || '').trim();
  if (t) return t;
  const a = item.atributos && typeof item.atributos === 'object' ? item.atributos : {};
  if (a.dimensoes) return String(a.dimensoes).trim();
  return '';
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

function loteStatusLabel(key, opcoes) {
  const k = String(key || 'em_criacao');
  const list = opcoes?.length ? opcoes : DEFAULT_LOTE_STATUS_OPCOES;
  return list.find((o) => o.key === k)?.label || k;
}

function loteOptionLabel(l, opcoes) {
  const forn = String(l.fornecedor || '').trim();
  const prefix = forn ? `${forn} — ` : '';
  const status = l.status && l.status !== 'em_criacao' ? ` · ${loteStatusLabel(l.status, opcoes)}` : '';
  return `${prefix}${l.nome} (${l.totalItens ?? 0})${status}`;
}

function categoriaLabelFor(itemOrKey) {
  if (itemOrKey == null) return 'Outro';
  if (typeof itemOrKey === 'string') {
    const key = itemOrKey.trim();
    if (!key || key === 'undefined') return 'Outro';
    return DEFAULT_CATEGORIAS.find((c) => c.key === key)?.label || key;
  }
  const item = itemOrKey;
  const key = String(item.categoria ?? item.atributos?.categoria ?? '').trim();
  if (key && key !== 'undefined') {
    const hit = DEFAULT_CATEGORIAS.find((c) => c.key === key);
    if (hit) return hit.label;
    return key;
  }
  if (item.origem === 'entregas') return 'Camiseta';
  const lab = String(item.categoriaLabel ?? '').trim();
  if (lab && lab !== 'undefined') return lab;
  return 'Outro';
}

export function initProducaoMateriaisModule() {
  const els = {
    loteSelect: document.getElementById('materiais-lote-select'),
    loteCard: document.getElementById('materiais-lote-card'),
    loteCardTitle: document.getElementById('materiais-lote-card-title'),
    loteCardStatusBadge: document.getElementById('materiais-lote-card-status-badge'),
    loteCardFornecedor: document.getElementById('materiais-lote-card-fornecedor'),
    loteStatusSelect: document.getElementById('materiais-lote-status'),
    summary: document.getElementById('materiais-summary'),
    meta: document.getElementById('materiais-meta'),
    resumoTable: document.getElementById('materiais-resumo-table'),
    itensTable: document.getElementById('materiais-itens-table'),
    btnNewLote: document.getElementById('btn-materiais-new-lote'),
    btnEditLote: document.getElementById('btn-materiais-edit-lote'),
    btnImportEntregas: document.getElementById('btn-materiais-import-entregas'),
    btnSiteItem: document.getElementById('btn-materiais-site-item'),
    btnPedidoTexto: document.getElementById('btn-materiais-pedido-texto'),
    loteModalBg: document.getElementById('materiais-lote-modal-bg'),
    loteModalTitle: document.getElementById('materiais-lote-modal-title'),
    loteModalErrors: document.getElementById('materiais-lote-modal-errors'),
    loteModalFornecedor: document.getElementById('materiais-lote-modal-fornecedor'),
    loteModalNome: document.getElementById('materiais-lote-modal-nome'),
    loteModalStatus: document.getElementById('materiais-lote-modal-status'),
    loteModalNotas: document.getElementById('materiais-lote-modal-notas'),
    loteModalCancel: document.getElementById('materiais-lote-modal-cancel'),
    loteModalSave: document.getElementById('materiais-lote-modal-save'),
    loteModalDelete: document.getElementById('materiais-lote-modal-delete'),
    itemModalBg: document.getElementById('materiais-item-modal-bg'),
    itemModalTitle: document.getElementById('materiais-item-modal-title'),
    itemModalErrors: document.getElementById('materiais-item-modal-errors'),
    itemModalDetachHint: document.getElementById('materiais-item-modal-detach-hint'),
    itemModalLote: document.getElementById('materiais-item-modal-lote'),
    itemModalCategoria: document.getElementById('materiais-item-modal-categoria'),
    itemModalUnidade: document.getElementById('materiais-item-modal-unidade'),
    itemModalReferencia: document.getElementById('materiais-item-modal-referencia'),
    itemModalModelo: document.getElementById('materiais-item-modal-modelo'),
    itemModalTamanho: document.getElementById('materiais-item-modal-tamanho'),
    itemTamanhoWrap: document.getElementById('materiais-item-tamanho-wrap'),
    itemDimensoesWrap: document.getElementById('materiais-item-dimensoes-wrap'),
    itemModalDimensoes: document.getElementById('materiais-item-modal-dimensoes'),
    itemModalQuantidade: document.getElementById('materiais-item-modal-quantidade'),
    itemModalMaterial: document.getElementById('materiais-item-modal-material'),
    itemModalCor: document.getElementById('materiais-item-modal-cor'),
    itemModalObs: document.getElementById('materiais-item-modal-obs'),
    itemModalCancel: document.getElementById('materiais-item-modal-cancel'),
    itemModalSave: document.getElementById('materiais-item-modal-save'),
    itemModalDelete: document.getElementById('materiais-item-modal-delete'),
    moveModalBg: document.getElementById('materiais-move-modal-bg'),
    moveModalTitle: document.getElementById('materiais-move-modal-title'),
    moveModalSub: document.getElementById('materiais-move-modal-sub'),
    moveModalErrors: document.getElementById('materiais-move-modal-errors'),
    moveModalLote: document.getElementById('materiais-move-modal-lote'),
    moveModalCancel: document.getElementById('materiais-move-modal-cancel'),
    moveModalConfirm: document.getElementById('materiais-move-modal-confirm'),
    pedidoModalBg: document.getElementById('materiais-pedido-modal-bg'),
    pedidoModalSub: document.getElementById('materiais-pedido-modal-sub'),
    pedidoModalErrors: document.getElementById('materiais-pedido-modal-errors'),
    pedidoModalEscopo: document.getElementById('materiais-pedido-modal-escopo'),
    pedidoModalDetalhe: document.getElementById('materiais-pedido-modal-detalhe'),
    pedidoModalTexto: document.getElementById('materiais-pedido-modal-texto'),
    pedidoModalClose: document.getElementById('materiais-pedido-modal-close'),
    pedidoModalRefresh: document.getElementById('materiais-pedido-modal-refresh'),
    pedidoModalCopy: document.getElementById('materiais-pedido-modal-copy'),
  };

  let lotes = [];
  let categorias = [...DEFAULT_CATEGORIAS];
  let unidades = [...DEFAULT_UNIDADES];
  let camisetaTamanhos = [...DEFAULT_CAMISETA_TAMANHOS];
  let currentLoteId = null;
  let detail = null;
  let loteEditId = null;
  let itemEditId = null;
  let moveItemId = null;
  let itemOriginLoteId = null;
  let loteStatusOpcoes = [...DEFAULT_LOTE_STATUS_OPCOES];
  let loteStatusSaving = false;

  function selectedLoteId() {
    const id = Number(els.loteSelect?.value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function mergeCategorias(fromApi) {
    if (!Array.isArray(fromApi) || !fromApi.length) return [...DEFAULT_CATEGORIAS];
    return fromApi;
  }

  function mergeUnidades(fromApi) {
    if (!Array.isArray(fromApi) || !fromApi.length) return [...DEFAULT_UNIDADES];
    return fromApi;
  }

  function mergeTamanhos(fromApi) {
    if (!Array.isArray(fromApi) || !fromApi.length) return [...DEFAULT_CAMISETA_TAMANHOS];
    return fromApi;
  }

  function mergeLoteStatusOpcoes(fromApi) {
    if (!Array.isArray(fromApi) || !fromApi.length) return [...DEFAULT_LOTE_STATUS_OPCOES];
    return fromApi;
  }

  function fillLoteStatusSelect(selectEl, selectedKey = 'em_criacao') {
    fillSelectOptions(selectEl, loteStatusOpcoes, { selected: selectedKey || 'em_criacao' });
  }

  function syncLoteStatusBadge(lote) {
    if (!els.loteCardStatusBadge) return;
    const status = lote?.status || 'em_criacao';
    const label = lote?.statusLabel || loteStatusLabel(status);
    els.loteCardStatusBadge.textContent = label;
    els.loteCardStatusBadge.className = `materiais-lote-status-badge materiais-lote-status-badge--${status}`;
    els.loteCardStatusBadge.classList.toggle('hidden', status === 'em_criacao');
  }

  function fillSelectOptions(selectEl, options, { valueKey = 'key', labelKey = 'label', selected = '' } = {}) {
    if (!selectEl) return;
    const list = Array.isArray(options) ? options : [];
    if (!list.length) return;
    if (typeof list[0] === 'string') {
      selectEl.innerHTML = list
        .map((o) => {
          const sel = o === selected ? ' selected' : '';
          return `<option value="${escapeHtml(o)}"${sel}>${escapeHtml(o)}</option>`;
        })
        .join('');
      return;
    }
    selectEl.innerHTML = list
      .map((o) => {
        const val = o[valueKey];
        const sel = val === selected ? ' selected' : '';
        return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(o[labelKey])}</option>`;
      })
      .join('');
  }

  function refreshItemCatalogSelects(selectedCategoria = 'outro', selectedUnidade = 'un', selectedTamanho = '') {
    fillSelectOptions(els.itemModalCategoria, categorias, { selected: selectedCategoria });
    fillSelectOptions(els.itemModalUnidade, unidades, { selected: selectedUnidade });
    fillTamanhoOptions(selectedTamanho);
  }

  function fillItemModalLoteOptions(selectedLoteIdValue) {
    if (!els.itemModalLote) return;
    if (!lotes.length) {
      els.itemModalLote.innerHTML = '<option value="">Nenhum lote</option>';
      els.itemModalLote.disabled = true;
      return;
    }
    els.itemModalLote.disabled = false;
    const selected = Number(selectedLoteIdValue) || selectedLoteId() || lotes[0].id;
    els.itemModalLote.innerHTML = lotes
      .map((l) => {
        const sel = l.id === selected ? ' selected' : '';
        return `<option value="${l.id}"${sel}>${escapeHtml(loteOptionLabel(l, loteStatusOpcoes))}</option>`;
      })
      .join('');
    els.itemModalLote.value = String(selected);
  }

  function fillTamanhoOptions(selected = '') {
    if (!els.itemModalTamanho) return;
    const opts = ['<option value="">—</option>'];
    for (const t of camisetaTamanhos) {
      const sel = selected === t ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(t)}"${sel}>${escapeHtml(t)}</option>`);
    }
    els.itemModalTamanho.innerHTML = opts.join('');
  }

  function syncItemModalFields() {
    const cat = els.itemModalCategoria?.value || 'outro';
    const isCamiseta = cat === 'camiseta';
    els.itemTamanhoWrap?.classList.toggle('hidden', !isCamiseta);
    els.itemDimensoesWrap?.classList.toggle('hidden', isCamiseta);
    if (isCamiseta && els.itemModalUnidade) els.itemModalUnidade.value = 'un';
  }

  function renderLoteSelect() {
    if (!els.loteSelect) return;
    const prev = selectedLoteId();
    if (!lotes.length) {
      els.loteSelect.innerHTML = '<option value="">Nenhum lote</option>';
      els.loteSelect.disabled = true;
      currentLoteId = null;
      return;
    }
    els.loteSelect.disabled = false;
    els.loteSelect.innerHTML = lotes
      .map((l) => {
        const selected = l.id === prev;
        return `<option value="${l.id}"${selected ? ' selected' : ''}>${escapeHtml(loteOptionLabel(l, loteStatusOpcoes))}</option>`;
      })
      .join('');
    if (!prev || !lotes.some((l) => l.id === prev)) {
      els.loteSelect.value = String(lotes[0].id);
    }
    currentLoteId = selectedLoteId();
  }

  function setActionsEnabled(enabled) {
    els.btnEditLote?.toggleAttribute('disabled', !enabled);
    els.btnImportEntregas?.toggleAttribute('disabled', !enabled);
    els.btnSiteItem?.toggleAttribute('disabled', !enabled);
    els.btnPedidoTexto?.toggleAttribute('disabled', !lotes.length);
  }

  function renderResumo() {
    const resumo = detail?.resumo || [];
    if (!resumo.length) {
      els.resumoTable.innerHTML =
        '<tr><td colspan="5" class="cell-empty">Sem itens no lote.</td></tr>';
      return;
    }
    els.resumoTable.innerHTML = resumo
      .map((row) => {
        const esp =
          row.especificacao && row.especificacao !== '—'
            ? escapeHtml(row.especificacao)
            : '<span class="cell-empty">—</span>';
        return `
      <tr>
        <td>${escapeHtml(categoriaLabelFor(row))}</td>
        <td>${escapeHtml(row.modelo)}</td>
        <td>${esp}</td>
        <td>${escapeHtml(row.unidade || 'un')}</td>
        <td class="num">${row.quantidade}</td>
      </tr>`;
      })
      .join('');
  }

  function renderItens() {
    const itens = detail?.itens || [];
    if (!itens.length) {
      els.itensTable.innerHTML =
        '<tr><td colspan="9" class="cell-empty">Importe camisetas das entregas ou adicione itens manualmente.</td></tr>';
      return;
    }
    els.itensTable.innerHTML = itens
      .map((item) => {
        const actions = `<div class="materiais-row-actions">
            <button type="button" class="tbtn tbtn-sm" data-action="edit-item" data-id="${item.id}">Editar</button>
            <button type="button" class="tbtn tbtn-sm" data-action="duplicate-item" data-id="${item.id}">Duplicar</button>
            <button type="button" class="tbtn tbtn-sm" data-action="move-item" data-id="${item.id}">Mover</button>
          </div>`;
        const esp = itemEspecificacao(item);
        const espCell = esp
          ? escapeHtml(esp)
          : '<span class="cell-empty" title="Pendente">—</span>';
        return `
      <tr>
        <td>${escapeHtml(categoriaLabelFor(item))}</td>
        <td>${escapeHtml(origemLabel(item.origem))}</td>
        <td>${escapeHtml(item.referencia || '—')}</td>
        <td>${escapeHtml(item.modelo)}</td>
        <td>${espCell}</td>
        <td>${escapeHtml(item.unidade || 'un')}</td>
        <td class="num">${item.quantidade}</td>
        <td class="materiais-atributos">${escapeHtml(formatAtributos(item.atributos))}</td>
        <td>${actions}</td>
      </tr>`;
      })
      .join('');

    els.itensTable.querySelectorAll('[data-action="edit-item"]').forEach((btn) => {
      btn.addEventListener('click', () => openItemModal(Number(btn.dataset.id)));
    });
    els.itensTable.querySelectorAll('[data-action="duplicate-item"]').forEach((btn) => {
      btn.addEventListener('click', () => void duplicateItem(Number(btn.dataset.id)));
    });
    els.itensTable.querySelectorAll('[data-action="move-item"]').forEach((btn) => {
      btn.addEventListener('click', () => openMoveModal(Number(btn.dataset.id)));
    });
  }

  function renderDetail() {
    const lote = detail?.lote;
    els.loteCard?.classList.toggle('hidden', !lote);
    if (!lote) {
      els.summary.textContent = 'Crie um lote por fornecedor para organizar a produção.';
      els.meta.textContent = '';
      renderResumo();
      renderItens();
      setActionsEnabled(false);
      els.btnPedidoTexto?.toggleAttribute('disabled', !lotes.length);
      els.loteStatusSelect?.toggleAttribute('disabled', true);
      return;
    }
    setActionsEnabled(true);
    if (els.loteCardTitle) els.loteCardTitle.textContent = lote.nome || 'Lote';
    if (els.loteCardFornecedor) {
      els.loteCardFornecedor.textContent = lote.fornecedor
        ? `Fornecedor: ${lote.fornecedor}`
        : 'Defina o fornecedor em Editar lote.';
    }
    fillLoteStatusSelect(els.loteStatusSelect, lote.status || 'em_criacao');
    els.loteStatusSelect?.toggleAttribute('disabled', loteStatusSaving);
    syncLoteStatusBadge(lote);
    const totalPecas = (detail.itens || []).reduce(
      (acc, i) => acc + Math.max(1, Number(i.quantidade) || 1),
      0,
    );
    const categoriasNoLote = new Set((detail.itens || []).map((i) => categoriaLabelFor(i)));
    let summary = `${totalPecas} unidade(s) · ${categoriasNoLote.size} categoria(s) · ${(detail.resumo || []).length} linha(s) no resumo`;
    els.summary.textContent = summary;
    const importado = lote.entregasImportadoEm
      ? `Camisetas das entregas atualizadas em ${formatDateTime(lote.entregasImportadoEm)}.`
      : 'Dica: use Importar camisetas para puxar tamanhos da tela Entregas.';
    els.meta.textContent = importado;
    renderResumo();
    renderItens();
  }

  async function loadLoteDetail(id) {
    if (!id) {
      detail = null;
      renderDetail();
      return;
    }
    const data = await fetchProducaoMateriaisLote(id);
    detail = data;
    camisetaTamanhos = mergeTamanhos(data.camisetaTamanhos);
    categorias = mergeCategorias(data.categorias);
    unidades = mergeUnidades(data.unidades);
    loteStatusOpcoes = mergeLoteStatusOpcoes(data.loteStatusOpcoes);
    currentLoteId = id;
    renderDetail();
  }

  async function loadMateriais() {
    try {
      const data = await fetchProducaoMateriaisLotes();
      lotes = data.lotes || [];
      camisetaTamanhos = mergeTamanhos(data.camisetaTamanhos);
      categorias = mergeCategorias(data.categorias);
      unidades = mergeUnidades(data.unidades);
      loteStatusOpcoes = mergeLoteStatusOpcoes(data.loteStatusOpcoes);
      fillLoteStatusSelect(els.loteModalStatus, 'em_criacao');
      refreshItemCatalogSelects('outro', 'un');
      renderLoteSelect();
      const id = selectedLoteId();
      if (id) await loadLoteDetail(id);
      else {
        detail = null;
        renderDetail();
      }
    } catch (err) {
      els.summary.textContent = err.message || 'Não foi possível carregar materiais.';
    }
  }

  function openLoteModal(edit = false) {
    loteEditId = edit ? currentLoteId : null;
    els.loteModalDelete?.classList.toggle('hidden', !loteEditId);
    els.loteModalTitle.textContent = loteEditId ? 'Editar lote' : 'Novo lote';
    els.loteModalErrors?.classList.add('hidden');
    if (loteEditId && detail?.lote) {
      els.loteModalFornecedor.value = detail.lote.fornecedor || '';
      els.loteModalNome.value = detail.lote.nome || '';
      els.loteModalNotas.value = detail.lote.notas || '';
      fillLoteStatusSelect(els.loteModalStatus, detail.lote.status || 'em_criacao');
    } else {
      els.loteModalFornecedor.value = '';
      els.loteModalNome.value = '';
      els.loteModalNotas.value = '';
      fillLoteStatusSelect(els.loteModalStatus, 'em_criacao');
    }
    els.loteModalBg?.classList.add('open');
    els.loteModalFornecedor?.focus();
  }

  function closeLoteModal() {
    els.loteModalBg?.classList.remove('open');
    loteEditId = null;
  }

  function openItemModal(itemId = null) {
    itemEditId = itemId;
    itemOriginLoteId = selectedLoteId();
    const item = itemId ? (detail?.itens || []).find((i) => i.id === itemId) : null;
    fillItemModalLoteOptions(itemOriginLoteId);
    els.itemModalDelete?.classList.toggle('hidden', !itemId);
    els.itemModalTitle.textContent = itemId ? 'Editar item' : 'Adicionar item';
    els.itemModalErrors?.classList.add('hidden');
    els.itemModalDetachHint?.classList.toggle('hidden', !itemId || item?.origem !== 'entregas');
    refreshItemCatalogSelects(item?.categoria || 'camiseta', item?.unidade || 'un', item?.tamanho || '');
    els.itemModalReferencia.value = item?.referencia || '';
    els.itemModalModelo.value = item?.modelo || '';
    els.itemModalQuantidade.value = String(item?.quantidade ?? 1);
    els.itemModalDimensoes.value = item?.atributos?.dimensoes || '';
    els.itemModalMaterial.value = item?.atributos?.material || '';
    els.itemModalCor.value = item?.atributos?.cor || '';
    els.itemModalObs.value = item?.atributos?.observacao || '';
    syncItemModalFields();
    els.itemModalBg?.classList.add('open');
    els.itemModalModelo?.focus();
  }

  function closeItemModal() {
    els.itemModalBg?.classList.remove('open');
    itemEditId = null;
    itemOriginLoteId = null;
  }

  async function saveLote() {
    const fornecedor = els.loteModalFornecedor?.value.trim();
    const nome = els.loteModalNome?.value.trim();
    if (!fornecedor) {
      els.loteModalErrors.textContent = 'Informe o fornecedor.';
      els.loteModalErrors.classList.remove('hidden');
      return;
    }
    if (!nome) {
      els.loteModalErrors.textContent = 'Informe o nome do lote.';
      els.loteModalErrors.classList.remove('hidden');
      return;
    }
    const payload = {
      fornecedor,
      nome,
      status: els.loteModalStatus?.value || 'em_criacao',
      notas: els.loteModalNotas?.value.trim() || '',
    };
    els.loteModalSave.disabled = true;
    try {
      if (loteEditId) {
        detail = await updateProducaoMateriaisLote(loteEditId, payload);
        currentLoteId = loteEditId;
      } else {
        detail = await createProducaoMateriaisLote(payload);
        currentLoteId = detail.lote?.id ?? null;
      }
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      renderLoteSelect();
      if (currentLoteId) els.loteSelect.value = String(currentLoteId);
      renderDetail();
      closeLoteModal();
    } catch (err) {
      els.loteModalErrors.textContent = err.message || 'Não foi possível salvar.';
      els.loteModalErrors.classList.remove('hidden');
    } finally {
      els.loteModalSave.disabled = false;
    }
  }

  async function saveLoteStatusFromCard() {
    const loteId = selectedLoteId();
    if (!loteId || loteStatusSaving) return;
    const next = els.loteStatusSelect?.value || 'em_criacao';
    const current = detail?.lote?.status || 'em_criacao';
    if (next === current) return;

    const prev = current;
    loteStatusSaving = true;
    els.loteStatusSelect?.toggleAttribute('disabled', true);
    try {
      detail = await updateProducaoMateriaisLote(loteId, { status: next });
      const idx = lotes.findIndex((l) => l.id === loteId);
      if (idx >= 0 && detail?.lote) {
        lotes[idx] = { ...lotes[idx], ...detail.lote };
      }
      renderLoteSelect();
      if (currentLoteId) els.loteSelect.value = String(currentLoteId);
      renderDetail();
    } catch (err) {
      fillLoteStatusSelect(els.loteStatusSelect, prev);
      alert(err.message || 'Não foi possível atualizar o status.');
    } finally {
      loteStatusSaving = false;
      els.loteStatusSelect?.toggleAttribute('disabled', false);
    }
  }

  async function deleteLote() {
    if (!loteEditId) return;
    if (!confirm('Excluir este lote e todos os itens?')) return;
    try {
      await deleteProducaoMateriaisLote(loteEditId);
      closeLoteModal();
      currentLoteId = null;
      detail = null;
      await loadMateriais();
    } catch (err) {
      alert(err.message || 'Não foi possível excluir.');
    }
  }

  async function refreshPedidoTexto() {
    els.pedidoModalErrors?.classList.add('hidden');
    const escopo = els.pedidoModalEscopo?.value || 'lote';
    const detalhe = Boolean(els.pedidoModalDetalhe?.checked);
    const loteId = escopo === 'lote' ? selectedLoteId() : null;
    if (escopo === 'lote' && !loteId) {
      if (els.pedidoModalErrors) {
        els.pedidoModalErrors.textContent = 'Selecione um lote ativo ou use “Todos os lotes”.';
        els.pedidoModalErrors.classList.remove('hidden');
      }
      return;
    }
    els.pedidoModalRefresh.disabled = true;
    if (els.pedidoModalTexto) els.pedidoModalTexto.value = 'Gerando texto…';
    try {
      const data = await fetchProducaoMateriaisPedidoTexto({
        loteId: escopo === 'lote' ? loteId : undefined,
        detalhe,
      });
      if (els.pedidoModalTexto) els.pedidoModalTexto.value = data.texto || '';
      if (els.pedidoModalSub) {
        const escopoLabel = escopo === 'lote' ? 'lote ativo' : `${data.lotes ?? 0} lote(s) com itens`;
        els.pedidoModalSub.textContent = `${data.eventoNome || 'Evento'} · ${escopoLabel}. Copie e cole no e-mail.`;
      }
    } catch (err) {
      if (els.pedidoModalErrors) {
        els.pedidoModalErrors.textContent = err.message || 'Não foi possível gerar o texto.';
        els.pedidoModalErrors.classList.remove('hidden');
      }
      if (els.pedidoModalTexto) els.pedidoModalTexto.value = '';
    } finally {
      els.pedidoModalRefresh.disabled = false;
    }
  }

  function openPedidoModal() {
    if (!lotes.length) {
      alert('Crie um lote com itens antes de gerar o texto.');
      return;
    }
    if (els.pedidoModalEscopo) {
      els.pedidoModalEscopo.value = selectedLoteId() ? 'lote' : 'todos';
    }
    els.pedidoModalBg?.classList.add('open');
    void refreshPedidoTexto();
  }

  function closePedidoModal() {
    els.pedidoModalBg?.classList.remove('open');
  }

  async function copyPedidoTexto() {
    const text = els.pedidoModalTexto?.value || '';
    if (!text.trim()) {
      alert('Não há texto para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const prev = els.pedidoModalCopy?.textContent;
      if (els.pedidoModalCopy) els.pedidoModalCopy.textContent = 'Copiado!';
      setTimeout(() => {
        if (els.pedidoModalCopy && prev) els.pedidoModalCopy.textContent = prev;
      }, 2000);
    } catch {
      els.pedidoModalTexto?.select();
      document.execCommand('copy');
      alert('Texto selecionado — use Ctrl+C se o navegador não copiou automaticamente.');
    }
  }

  async function importEntregas() {
    const id = selectedLoteId();
    if (!id) return;
    if (
      !confirm(
        'Importar camisetas das entregas?\n\nUma linha por ingresso (plano + tamanho). Só substitui itens de entregas neste lote; itens manuais permanecem.',
      )
    ) {
      return;
    }
    els.btnImportEntregas.disabled = true;
    try {
      detail = await importarEntregasProducaoMateriaisLote(id);
      const n = detail.importadosEntregas ?? 0;
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      renderLoteSelect();
      renderDetail();
      alert(`${n} peça(s) importada(s) das entregas.`);
    } catch (err) {
      alert(err.message || 'Falha ao importar.');
    } finally {
      els.btnImportEntregas.disabled = false;
    }
  }

  function fillMoveLoteOptions() {
    const fromId = selectedLoteId();
    const destinos = lotes.filter((l) => l.id !== fromId);
    if (!els.moveModalLote) return;
    if (!destinos.length) {
      els.moveModalLote.innerHTML = '<option value="">Nenhum outro lote</option>';
      els.moveModalLote.disabled = true;
      return;
    }
    els.moveModalLote.disabled = false;
    els.moveModalLote.innerHTML = destinos
      .map((l) => `<option value="${l.id}">${escapeHtml(loteOptionLabel(l, loteStatusOpcoes))}</option>`)
      .join('');
  }

  function openMoveModal(itemId) {
    const loteId = selectedLoteId();
    if (!loteId || !itemId) return;
    const item = (detail?.itens || []).find((i) => i.id === itemId);
    if (!item) return;
    moveItemId = itemId;
    fillMoveLoteOptions();
    if (els.moveModalSub) {
      const esp = itemEspecificacao(item) || '—';
      els.moveModalSub.textContent = `${item.modelo} · ${esp} · qtd ${item.quantidade}`;
    }
    els.moveModalErrors?.classList.add('hidden');
    const outros = lotes.filter((l) => l.id !== loteId);
    if (!outros.length) {
      if (els.moveModalErrors) {
        els.moveModalErrors.textContent = 'Crie outro lote antes de mover itens entre fornecedores.';
        els.moveModalErrors.classList.remove('hidden');
      }
      if (els.moveModalConfirm) els.moveModalConfirm.disabled = true;
    } else {
      els.moveModalErrors?.classList.add('hidden');
      if (els.moveModalConfirm) els.moveModalConfirm.disabled = false;
    }
    els.moveModalBg?.classList.add('open');
  }

  function closeMoveModal() {
    els.moveModalBg?.classList.remove('open');
    moveItemId = null;
  }

  async function confirmMoveItem() {
    const fromLoteId = selectedLoteId();
    if (!fromLoteId || !moveItemId) return;
    const toLoteId = Number(els.moveModalLote?.value);
    if (!Number.isInteger(toLoteId) || toLoteId <= 0) {
      els.moveModalErrors.textContent = 'Selecione o lote de destino.';
      els.moveModalErrors.classList.remove('hidden');
      return;
    }
    els.moveModalConfirm.disabled = true;
    try {
      const data = await moveProducaoMateriaisItem(fromLoteId, moveItemId, {
        loteDestinoId: toLoteId,
      });
      closeMoveModal();
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      detail = data.to;
      if (els.loteSelect) els.loteSelect.value = String(toLoteId);
      currentLoteId = toLoteId;
      renderLoteSelect();
      renderDetail();
    } catch (err) {
      els.moveModalErrors.textContent = err.message || 'Não foi possível mover.';
      els.moveModalErrors.classList.remove('hidden');
    } finally {
      els.moveModalConfirm.disabled = false;
    }
  }

  async function duplicateItem(itemId) {
    const loteId = selectedLoteId();
    if (!loteId || !itemId) return;
    if (
      !confirm(
        'Duplicar este item na lista?\n\nSerá criada uma cópia manual (quantidade 1) para você ajustar tamanho, modelo, etc.',
      )
    ) {
      return;
    }
    try {
      const data = await duplicateProducaoMateriaisItem(loteId, itemId, { quantidade: 1 });
      detail = data;
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      renderLoteSelect();
      renderDetail();
      if (data.item?.id) openItemModal(data.item.id);
    } catch (err) {
      alert(err.message || 'Não foi possível duplicar.');
    }
  }

  async function saveItem() {
    const viewLoteId = selectedLoteId();
    const targetLoteId = Number(els.itemModalLote?.value) || viewLoteId;
    if (!targetLoteId) {
      els.itemModalErrors.textContent = 'Selecione o lote de produção.';
      els.itemModalErrors.classList.remove('hidden');
      return;
    }
    const fromLoteId = itemOriginLoteId || viewLoteId;
    const editingEntregas =
      itemEditId && (detail?.itens || []).find((i) => i.id === itemEditId)?.origem === 'entregas';
    if (
      editingEntregas &&
      !confirm(
        'Salvar alterações neste item?\n\nEle deixará de sincronizar com Entregas e passará a ser manual.',
      )
    ) {
      return;
    }
    const categoria = els.itemModalCategoria?.value || 'outro';
    const payload = {
      categoria,
      unidade: els.itemModalUnidade?.value || 'un',
      referencia: els.itemModalReferencia?.value.trim() || '',
      modelo: els.itemModalModelo?.value.trim() || '',
      tamanho: categoria === 'camiseta' ? els.itemModalTamanho?.value || '' : '',
      dimensoes: categoria !== 'camiseta' ? els.itemModalDimensoes?.value.trim() || '' : '',
      quantidade: Number(els.itemModalQuantidade?.value) || 1,
      material: els.itemModalMaterial?.value.trim() || '',
      cor: els.itemModalCor?.value.trim() || '',
      observacao: els.itemModalObs?.value.trim() || '',
    };
    els.itemModalSave.disabled = true;
    try {
      if (itemEditId) {
        if (fromLoteId && targetLoteId !== fromLoteId) {
          const moved = await moveProducaoMateriaisItem(fromLoteId, itemEditId, {
            loteDestinoId: targetLoteId,
          });
          detail = moved.to;
        }
        detail = await updateProducaoMateriaisItem(targetLoteId, itemEditId, payload);
      } else {
        const data = await createProducaoMateriaisItem(targetLoteId, payload);
        detail = data;
      }
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      currentLoteId = targetLoteId;
      if (els.loteSelect) els.loteSelect.value = String(targetLoteId);
      renderLoteSelect();
      renderDetail();
      closeItemModal();
    } catch (err) {
      els.itemModalErrors.textContent = err.message || 'Não foi possível salvar.';
      els.itemModalErrors.classList.remove('hidden');
    } finally {
      els.itemModalSave.disabled = false;
    }
  }

  async function deleteItem() {
    const loteId = itemOriginLoteId || selectedLoteId();
    if (!loteId || !itemEditId) return;
    if (!confirm('Excluir este item?')) return;
    try {
      detail = await deleteProducaoMateriaisItem(loteId, itemEditId);
      closeItemModal();
      const listData = await fetchProducaoMateriaisLotes();
      lotes = listData.lotes || [];
      renderLoteSelect();
      renderDetail();
    } catch (err) {
      alert(err.message || 'Não foi possível excluir.');
    }
  }

  refreshItemCatalogSelects('camiseta', 'un');
  els.itemModalCategoria?.addEventListener('change', syncItemModalFields);
  els.loteSelect?.addEventListener('change', () => {
    void loadLoteDetail(selectedLoteId());
  });
  els.loteStatusSelect?.addEventListener('change', () => void saveLoteStatusFromCard());
  els.btnNewLote?.addEventListener('click', () => openLoteModal(false));
  els.btnEditLote?.addEventListener('click', () => openLoteModal(true));
  els.btnImportEntregas?.addEventListener('click', () => void importEntregas());
  els.btnSiteItem?.addEventListener('click', () => openItemModal());
  els.btnPedidoTexto?.addEventListener('click', () => openPedidoModal());
  els.pedidoModalClose?.addEventListener('click', closePedidoModal);
  els.pedidoModalRefresh?.addEventListener('click', () => void refreshPedidoTexto());
  els.pedidoModalCopy?.addEventListener('click', () => void copyPedidoTexto());
  els.pedidoModalEscopo?.addEventListener('change', () => void refreshPedidoTexto());
  els.pedidoModalDetalhe?.addEventListener('change', () => void refreshPedidoTexto());
  els.pedidoModalBg?.addEventListener('click', (e) => {
    if (e.target === els.pedidoModalBg) closePedidoModal();
  });
  els.loteModalCancel?.addEventListener('click', closeLoteModal);
  els.loteModalSave?.addEventListener('click', () => void saveLote());
  els.loteModalDelete?.addEventListener('click', () => void deleteLote());
  els.itemModalCancel?.addEventListener('click', closeItemModal);
  els.itemModalSave?.addEventListener('click', () => void saveItem());
  els.itemModalDelete?.addEventListener('click', () => void deleteItem());
  els.loteModalBg?.addEventListener('click', (e) => {
    if (e.target === els.loteModalBg) closeLoteModal();
  });
  els.itemModalBg?.addEventListener('click', (e) => {
    if (e.target === els.itemModalBg) closeItemModal();
  });
  els.moveModalCancel?.addEventListener('click', closeMoveModal);
  els.moveModalConfirm?.addEventListener('click', () => void confirmMoveItem());
  els.moveModalBg?.addEventListener('click', (e) => {
    if (e.target === els.moveModalBg) closeMoveModal();
  });

  return { loadMateriais };
}
