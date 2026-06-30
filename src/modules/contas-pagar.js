import {
  fetchFinanceiroCategorias,
  fetchFinanceiroPlanoContas,
  fetchContasPagar,
  createFinanceiroCategoria,
  createFinanceiroPlanoConta,
  createContaPagar,
  updateContaPagar,
  deleteContaPagar,
  bulkUpdateContasPagarFase,
  bulkUpdateContasPagar,
} from '../lib/api.js';
import {
  escapeHtml,
  fmtDateOnly,
  fmtMoney,
  formatValorInput,
  maskValorInput,
  parseValor,
  toDateInputValue,
} from '../lib/format.js';
import {
  readContasPagarDraft,
  writeContasPagarDraft,
  clearContasPagarDraft,
} from '../lib/contas-pagar-draft.js';

const STATUS_LABEL = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

const FASE_LABEL = {
  pre: 'Pré-evento',
  pos: 'Pós-evento',
};

const DRAFT_SAVE_DEBOUNCE_MS = 400;

function summarizeFromContas(contas) {
  const ativas = contas.filter((c) => c.status !== 'cancelado');
  let previstoPre = 0;
  let previstoPos = 0;
  let realizadoPre = 0;
  let realizadoPos = 0;

  for (const c of ativas) {
    const prev = Number(c.valorPrevisto) || 0;
    const pago = Number(c.valorPago) || 0;
    if (c.fase === 'pos') {
      previstoPos += prev;
      realizadoPos += pago;
    } else {
      previstoPre += prev;
      realizadoPre += pago;
    }
  }

  const previstoGeral = previstoPre + previstoPos;
  const realizadoGeral = realizadoPre + realizadoPos;

  return {
    previstoPre,
    previstoPos,
    previstoGeral,
    realizadoPre,
    realizadoPos,
    realizadoGeral,
    previsto: previstoGeral,
    realizado: realizadoGeral,
    falta: Math.max(0, previstoGeral - realizadoGeral),
  };
}

function cellMoney(val) {
  return fmtMoney(val);
}

function cellQty(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function calcValorUnitario(previsto, qtd) {
  const p = Number(previsto) || 0;
  const q = Number(qtd) || 0;
  if (q <= 0) return null;
  return p / q;
}

function readQtyInput(el) {
  if (!el) return null;
  const raw = el.value.trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function readMoneyInput(el) {
  if (!el) return 0;
  const raw = el.value.trim();
  if (!raw) return 0;
  return parseValor(raw);
}

function planoLabel(p) {
  const cod = p.codigo ? `${p.codigo} — ` : '';
  return `${cod}${p.nome}`;
}

function normalizeNome(value) {
  return String(value ?? '').trim();
}

function sameNome(a, b) {
  return normalizeNome(a).toLowerCase() === normalizeNome(b).toLowerCase();
}

let contasPagarInstance = null;

export function initContasPagarModule() {
  if (contasPagarInstance) return contasPagarInstance;

  const els = {
    kpis: document.getElementById('contas-pagar-kpis'),
    summary: document.getElementById('contas-pagar-summary'),
    empty: document.getElementById('contas-pagar-empty'),
    tableWrap: document.getElementById('contas-pagar-table-wrap'),
    table: document.getElementById('contas-pagar-table'),
    tableFoot: document.getElementById('contas-pagar-table-foot'),
    btnNew: document.getElementById('btn-contas-pagar-new'),
    selectBar: document.getElementById('contas-pagar-select-bar'),
    selCount: document.getElementById('contas-pagar-sel-count'),
    chkAll: document.getElementById('contas-pagar-chk-all'),
    btnFasePre: document.getElementById('btn-contas-pagar-fase-pre'),
    btnFasePos: document.getElementById('btn-contas-pagar-fase-pos'),
    btnBulkValores: document.getElementById('btn-contas-pagar-bulk-valores'),
    btnClearSelection: document.getElementById('btn-contas-pagar-clear-selection'),
    bulkModalBg: document.getElementById('contas-pagar-bulk-modal-bg'),
    bulkModalSub: document.getElementById('contas-pagar-bulk-modal-sub'),
    bulkModalErrors: document.getElementById('contas-pagar-bulk-modal-errors'),
    bulkValorPrevisto: document.getElementById('contas-pagar-bulk-valor-previsto'),
    bulkQuantidade: document.getElementById('contas-pagar-bulk-quantidade'),
    btnBulkCancel: document.getElementById('contas-pagar-bulk-modal-cancel'),
    btnBulkApply: document.getElementById('contas-pagar-bulk-modal-apply'),
    modalBg: document.getElementById('contas-pagar-modal-bg'),
    modalTitle: document.getElementById('contas-pagar-modal-title'),
    modalSub: document.getElementById('contas-pagar-modal-sub'),
    formErrors: document.getElementById('contas-pagar-modal-errors'),
    fieldCategoria: document.getElementById('contas-pagar-modal-categoria'),
    fieldPlano: document.getElementById('contas-pagar-modal-plano'),
    datalistCategorias: document.getElementById('contas-pagar-categorias-list'),
    datalistPlano: document.getElementById('contas-pagar-plano-list'),
    fieldFornecedor: document.getElementById('contas-pagar-modal-fornecedor'),
    fieldDescricao: document.getElementById('contas-pagar-modal-descricao'),
    fieldQuantidadePrevista: document.getElementById('contas-pagar-modal-quantidade-prevista'),
    fieldValorUnitario: document.getElementById('contas-pagar-modal-valor-unitario'),
    fieldValorPrevisto: document.getElementById('contas-pagar-modal-valor-previsto'),
    fieldValorPago: document.getElementById('contas-pagar-modal-valor-pago'),
    fieldDtVencimento: document.getElementById('contas-pagar-modal-dt-vencimento'),
    fieldDtPagamento: document.getElementById('contas-pagar-modal-dt-pagamento'),
    fieldStatus: document.getElementById('contas-pagar-modal-status'),
    fieldObs: document.getElementById('contas-pagar-modal-obs'),
    fieldBonificado: document.getElementById('contas-pagar-modal-bonificado'),
    fieldBonificadoRefWrap: document.getElementById('contas-pagar-modal-bonificado-ref-wrap'),
    fieldBonificadoRef: document.getElementById('contas-pagar-modal-bonificado-ref'),
    btnCancel: document.getElementById('contas-pagar-modal-cancel'),
    btnSave: document.getElementById('contas-pagar-modal-save'),
    btnDelete: document.getElementById('contas-pagar-modal-delete'),
    draftHint: document.getElementById('contas-pagar-modal-draft-hint'),
    draftDiscard: document.getElementById('contas-pagar-modal-draft-discard'),
  };

  [els.fieldValorPago, els.bulkValorPrevisto].filter(Boolean).forEach((input) => {
    input.addEventListener('input', () => maskValorInput(input));
  });

  let valorRecalcLock = false;
  let draftSaveTimer = null;
  let draftRestoring = false;
  let lastEditedValor = null;

  function readModalQty() {
    const q = readQtyInput(els.fieldQuantidadePrevista);
    return q != null && q > 0 ? q : null;
  }

  function setMoneyField(el, value) {
    if (!el) return;
    valorRecalcLock = true;
    try {
      if (value == null || !Number.isFinite(value)) {
        el.value = '';
      } else {
        el.value = formatValorInput(value);
      }
    } finally {
      valorRecalcLock = false;
    }
  }

  function onValorUnitarioInput() {
    if (valorRecalcLock) return;
    if (!draftRestoring && editId == null) lastEditedValor = 'unit';
    maskValorInput(els.fieldValorUnitario);
    const unit = readMoneyInput(els.fieldValorUnitario);
    const qty = readModalQty();
    if (unit > 0 && qty) {
      setMoneyField(els.fieldValorPrevisto, unit * qty);
    }
  }

  function onValorPrevistoInput() {
    if (valorRecalcLock) return;
    if (!draftRestoring && editId == null) lastEditedValor = 'total';
    maskValorInput(els.fieldValorPrevisto);
    const total = readMoneyInput(els.fieldValorPrevisto);
    const qty = readModalQty();
    if (total > 0 && qty) {
      setMoneyField(els.fieldValorUnitario, total / qty);
    }
  }

  function onQuantidadeInput() {
    if (valorRecalcLock) return;
    if (!draftRestoring && editId == null) lastEditedValor = 'qty';
    const qty = readModalQty();
    if (!qty) return;
    const unit = readMoneyInput(els.fieldValorUnitario);
    const total = readMoneyInput(els.fieldValorPrevisto);
    if (unit > 0) {
      setMoneyField(els.fieldValorPrevisto, unit * qty);
    } else if (total > 0) {
      setMoneyField(els.fieldValorUnitario, total / qty);
    }
  }

  els.fieldValorUnitario?.addEventListener('input', onValorUnitarioInput);
  els.fieldValorPrevisto?.addEventListener('input', onValorPrevistoInput);
  els.fieldQuantidadePrevista?.addEventListener('input', onQuantidadeInput);

  let contas = [];
  let categorias = [];
  let planoContas = [];
  let totais = summarizeFromContas([]);
  let editId = null;
  let inlineEditId = null;
  let loading = false;
  let duplicating = false;
  let bulkUpdating = false;
  const selectedIds = new Set();

  function isSelectable(conta) {
    return conta.status !== 'cancelado';
  }

  function selectableContas() {
    return contas.filter(isSelectable);
  }

  function pruneSelection() {
    const validIds = new Set(contas.map((c) => c.id));
    for (const id of selectedIds) {
      if (!validIds.has(id)) selectedIds.delete(id);
    }
  }

  function updateSelectionUi() {
    const selected = contas.filter((c) => selectedIds.has(c.id));
    els.selectBar?.classList.toggle('visible', selected.length > 0);
    if (els.selCount) els.selCount.textContent = selected.length;

    els.table?.querySelectorAll('tr[data-id]').forEach((row) => {
      const id = Number(row.dataset.id);
      row.classList.toggle('selected-row', selectedIds.has(id));
      const chk = row.querySelector('.row-chk');
      if (chk) chk.checked = selectedIds.has(id);
    });

    const visible = selectableContas();
    const checked = visible.filter((c) => selectedIds.has(c.id));
    if (els.chkAll) {
      els.chkAll.checked = visible.length > 0 && checked.length === visible.length;
      els.chkAll.indeterminate = checked.length > 0 && checked.length < visible.length;
    }

    const disabled = bulkUpdating || selected.length === 0;
    els.btnFasePre?.toggleAttribute('disabled', disabled);
    els.btnFasePos?.toggleAttribute('disabled', disabled);
    els.btnBulkValores?.toggleAttribute('disabled', disabled);
  }

  function toggleSelect(id, force) {
    const conta = contas.find((c) => c.id === id);
    if (!conta || !isSelectable(conta)) return;
    const on = force !== undefined ? force : !selectedIds.has(id);
    if (on) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUi();
  }

  function clearSelection() {
    selectedIds.clear();
    updateSelectionUi();
  }

  function toggleSelectAll(checked) {
    selectableContas().forEach((c) => {
      if (checked) selectedIds.add(c.id);
      else selectedIds.delete(c.id);
    });
    updateSelectionUi();
  }

  function renderRowCheckbox(c) {
    const selectable = isSelectable(c);
    const checked = selectedIds.has(c.id);
    if (!selectable) {
      return '<td class="chk-cell"><input class="chk row-chk" type="checkbox" disabled title="Conta cancelada"></td>';
    }
    return `<td class="chk-cell"><input class="chk row-chk" type="checkbox" data-id="${c.id}" ${checked ? 'checked' : ''}></td>`;
  }

  function showFormErrors(messages) {
    if (!els.formErrors) return;
    const list = Array.isArray(messages) ? messages : [messages];
    const text = list
      .map((m) => (typeof m === 'string' ? m : m?.message))
      .filter(Boolean)
      .join(' ');
    if (!text) {
      els.formErrors.classList.add('hidden');
      els.formErrors.textContent = '';
      return;
    }
    els.formErrors.textContent = text;
    els.formErrors.classList.remove('hidden');
  }

  function findCategoriaByNome(nome) {
    const n = normalizeNome(nome);
    if (!n) return null;
    return categorias.find((c) => sameNome(c.nome, n)) || null;
  }

  function planosDaCategoria(categoriaId) {
    return planoContas.filter((p) => p.categoriaId === Number(categoriaId));
  }

  function refreshCategoriaDatalist() {
    if (!els.datalistCategorias) return;
    els.datalistCategorias.innerHTML = categorias
      .filter((c) => c.ativo !== false)
      .map((c) => `<option value="${escapeHtml(c.nome)}"></option>`)
      .join('');
  }

  function refreshPlanoDatalist(categoriaNome = els.fieldCategoria?.value) {
    if (!els.datalistPlano) return;
    const cat = findCategoriaByNome(categoriaNome);
    const list = cat ? planosDaCategoria(cat.id).filter((p) => p.ativo !== false) : [];
    els.datalistPlano.innerHTML = list
      .map((p) => `<option value="${escapeHtml(planoLabel(p))}"></option>`)
      .join('');
  }

  function parsePlanoNomeInput(raw, categoriaId) {
    const text = normalizeNome(raw);
    if (!text) return '';
    const list = planosDaCategoria(categoriaId);
    const byLabel = list.find((p) => sameNome(planoLabel(p), text));
    if (byLabel) return byLabel.nome;
    const byNome = list.find((p) => sameNome(p.nome, text));
    if (byNome) return byNome.nome;
    if (text.includes(' — ')) {
      const parts = text.split(' — ');
      return normalizeNome(parts[parts.length - 1]);
    }
    return text;
  }

  async function resolveCategoriaId(nome) {
    const trimmed = normalizeNome(nome);
    if (!trimmed) return null;
    const found = findCategoriaByNome(trimmed);
    if (found) return found.id;
    const { categoria } = await createFinanceiroCategoria({ nome: trimmed });
    if (categoria) {
      categorias.push(categoria);
      categorias.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
      refreshCategoriaDatalist();
    }
    return categoria?.id || null;
  }

  async function resolvePlanoContaId(categoriaId, nomeInput) {
    const nome = parsePlanoNomeInput(nomeInput, categoriaId);
    if (!nome) return null;
    const list = planosDaCategoria(categoriaId);
    const found = list.find((p) => sameNome(p.nome, nome) || sameNome(planoLabel(p), nomeInput));
    if (found) return found.id;
    const { conta } = await createFinanceiroPlanoConta({ categoriaId, nome });
    if (conta) {
      planoContas.push(conta);
      refreshPlanoDatalist(els.fieldCategoria?.value);
    }
    return conta?.id || null;
  }

  function statusBadge(status) {
    const label = STATUS_LABEL[status] || status;
    return `<span class="fin-status fin-status--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function faseBadge(fase) {
    const key = fase === 'pos' ? 'pos' : 'pre';
    const label = FASE_LABEL[key];
    return `<span class="fin-fase fin-fase--${escapeHtml(key)}">${escapeHtml(label)}</span>`;
  }

  function truncateRef(ref, max = 18) {
    const s = String(ref ?? '').trim();
    if (!s) return '';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function bonificadoCell(c) {
    if (!c.bonificado) return '—';
    const ref = truncateRef(c.bonificadoRef);
    const refHtml = ref
      ? `<span class="fin-bonificado-ref" title="${escapeHtml(c.bonificadoRef || '')}">${escapeHtml(ref)}</span>`
      : '';
    return `<span class="fin-bonificado">Bonificado</span>${refHtml}`;
  }

  function updateBonificadoRefVisibility() {
    const on = Boolean(els.fieldBonificado?.checked);
    els.fieldBonificadoRefWrap?.classList.toggle('hidden', !on);
    if (!on && els.fieldBonificadoRef) els.fieldBonificadoRef.value = '';
  }

  function contaToPayload(conta, overrides = {}) {
    return {
      categoriaId: conta.categoriaId,
      planoContaId: conta.planoContaId,
      fornecedor: overrides.fornecedor ?? conta.fornecedor ?? '',
      descricao: conta.descricao,
      quantidadePrevista: overrides.quantidadePrevista ?? conta.quantidadePrevista ?? 1,
      valorPrevisto: overrides.valorPrevisto ?? conta.valorPrevisto,
      valorPago: overrides.valorPago ?? conta.valorPago ?? 0,
      dtVencimento: conta.dtVencimento || '',
      dtPagamento: overrides.dtPagamento ?? conta.dtPagamento ?? '',
      status: overrides.status ?? conta.status ?? 'pendente',
      obs: conta.obs || '',
      bonificado: overrides.bonificado ?? conta.bonificado ?? false,
      bonificadoRef: overrides.bonificadoRef ?? conta.bonificadoRef ?? '',
    };
  }

  function renderInlineRow(c) {
    const prev = Number(c.valorPrevisto) || 0;
    const pago = Number(c.valorPago) || 0;
    const qtd = Number(c.quantidadePrevista) || 1;
    const falta = Math.max(0, prev - pago);
    const unit = calcValorUnitario(prev, qtd);
    const plano = [c.planoContaCodigo, c.planoContaNome].filter(Boolean).join(' — ');
    return `
      <tr class="fin-custo-row fin-custo-row--editing" data-id="${c.id}">
        ${renderRowCheckbox(c)}
        <td class="fin-custo-cat">${escapeHtml(c.categoriaNome || '—')}</td>
        <td class="fin-col-plano">${escapeHtml(plano || '—')}</td>
        <td><input type="text" class="fin-inline-input" data-field="fornecedor" value="${escapeHtml(c.fornecedor || '')}" placeholder="Fornecedor" autocomplete="off" /></td>
        <td>${escapeHtml(c.descricao || '—')}</td>
        <td>${faseBadge(c.fase)}</td>
        <td class="fin-col-qty"><input type="number" class="fin-inline-input fin-inline-qty" data-field="quantidadePrevista" step="0.001" min="0.001" inputmode="decimal" value="${escapeHtml(String(qtd))}" /></td>
        <td class="fin-col-money"><input type="text" class="fin-inline-input fin-inline-money" data-field="valorPrevisto" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(prev))}" /></td>
        <td class="fin-col-money">${unit != null ? cellMoney(unit) : '—'}</td>
        <td class="fin-col-money"><input type="text" class="fin-inline-input fin-inline-money fin-val--pos" data-field="valorPago" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(pago))}" /></td>
        <td class="fin-col-money fin-val--warn">${cellMoney(falta)}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="fin-col-bonificado">${bonificadoCell(c)}</td>
        <td class="fin-col-date">${escapeHtml(fmtDateOnly(c.dtVencimento))}</td>
        <td class="fin-col-actions">
          <div class="fin-inline-actions">
            <button type="button" class="tbtn primary" data-action="inline-save">Salvar</button>
            <button type="button" class="tbtn" data-action="inline-cancel">Cancelar</button>
          </div>
        </td>
      </tr>`;
  }

  function renderNormalRow(c) {
    const prev = Number(c.valorPrevisto) || 0;
    const pago = Number(c.valorPago) || 0;
    const qtd = Number(c.quantidadePrevista) || 1;
    const falta = Math.max(0, prev - pago);
    const unit = c.valorUnitario ?? calcValorUnitario(prev, qtd);
    const plano = [c.planoContaCodigo, c.planoContaNome].filter(Boolean).join(' — ');
    return `
      <tr class="fin-custo-row${selectedIds.has(c.id) ? ' selected-row' : ''}" data-id="${c.id}" tabindex="0" role="button" title="Clique para editar">
        ${renderRowCheckbox(c)}
        <td class="fin-custo-cat">${escapeHtml(c.categoriaNome || '—')}</td>
        <td class="fin-col-plano">${escapeHtml(plano || '—')}</td>
        <td>${escapeHtml(c.fornecedor || '—')}</td>
        <td>${escapeHtml(c.descricao || '—')}</td>
        <td>${faseBadge(c.fase)}</td>
        <td class="fin-col-qty">${cellQty(qtd)}</td>
        <td class="fin-col-money">${cellMoney(prev)}</td>
        <td class="fin-col-money">${unit != null ? cellMoney(unit) : '—'}</td>
        <td class="fin-col-money fin-val--pos">${cellMoney(pago)}</td>
        <td class="fin-col-money fin-val--warn">${cellMoney(falta)}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="fin-col-bonificado">${bonificadoCell(c)}</td>
        <td class="fin-col-date">${escapeHtml(fmtDateOnly(c.dtVencimento))}</td>
        <td class="fin-col-actions">
          <button type="button" class="tbtn" data-action="duplicate" title="Duplicar conta">Duplicar</button>
        </td>
      </tr>`;
  }

  function bindInlineMoneyMasks() {
    els.table?.querySelectorAll('.fin-inline-money').forEach((input) => {
      input.addEventListener('input', () => maskValorInput(input));
    });
  }

  function focusInlineEdit(id) {
    requestAnimationFrame(() => {
      const input = els.table?.querySelector(`tr[data-id="${id}"] [data-field="fornecedor"]`);
      input?.focus();
      input?.select();
    });
  }

  function renderKpis() {
    if (!els.kpis) return;
    const t = totais;
    const hasContas = contas.some((c) => c.status !== 'cancelado');
    els.kpis.classList.toggle('hidden', !hasContas);
    if (!hasContas) {
      els.kpis.innerHTML = '';
      return;
    }

    els.kpis.innerHTML = `
      <div class="financeiro-kpi">
        <span class="financeiro-kpi-label">Previsto pré-evento</span>
        <strong class="financeiro-kpi-val">${cellMoney(t.previstoPre)}</strong>
      </div>
      <div class="financeiro-kpi">
        <span class="financeiro-kpi-label">Previsto pós-evento</span>
        <strong class="financeiro-kpi-val">${cellMoney(t.previstoPos)}</strong>
      </div>
      <div class="financeiro-kpi financeiro-kpi--total">
        <span class="financeiro-kpi-label">Total previsto</span>
        <strong class="financeiro-kpi-val">${cellMoney(t.previstoGeral)}</strong>
      </div>
      <div class="financeiro-kpi">
        <span class="financeiro-kpi-label">Realizado pré-evento</span>
        <strong class="financeiro-kpi-val fin-val--pos">${cellMoney(t.realizadoPre)}</strong>
      </div>
      <div class="financeiro-kpi">
        <span class="financeiro-kpi-label">Realizado pós-evento</span>
        <strong class="financeiro-kpi-val fin-val--pos">${cellMoney(t.realizadoPos)}</strong>
      </div>
      <div class="financeiro-kpi financeiro-kpi--total">
        <span class="financeiro-kpi-label">Total realizado</span>
        <strong class="financeiro-kpi-val fin-val--pos">${cellMoney(t.realizadoGeral)}</strong>
      </div>`;
  }

  function renderTable() {
    const ativas = contas.filter((c) => c.status !== 'cancelado');
    const empty = !contas.length;

    els.empty?.classList.toggle('hidden', !empty);
    els.tableWrap?.classList.toggle('hidden', empty);

    if (!els.table) return;

    if (empty) {
      els.table.innerHTML = '';
      if (els.tableFoot) els.tableFoot.innerHTML = '';
      if (els.summary) els.summary.textContent = '';
      totais = summarizeFromContas([]);
      clearSelection();
      renderKpis();
      return;
    }

    pruneSelection();

    let totalPrev = 0;
    let totalPago = 0;
    contas.forEach((c) => {
      if (c.status !== 'cancelado') {
        totalPrev += Number(c.valorPrevisto) || 0;
        totalPago += Number(c.valorPago) || 0;
      }
    });

    els.table.innerHTML = contas
      .map((c) => (c.id === inlineEditId ? renderInlineRow(c) : renderNormalRow(c)))
      .join('');

    bindInlineMoneyMasks();
    if (inlineEditId) focusInlineEdit(inlineEditId);

    if (els.tableFoot) {
      els.tableFoot.innerHTML = `
        <tr class="fin-custo-total">
          <td colspan="7">Total (exc. canceladas)</td>
          <td class="fin-col-money">${cellMoney(totalPrev)}</td>
          <td></td>
          <td class="fin-col-money fin-val--pos">${cellMoney(totalPago)}</td>
          <td class="fin-col-money fin-val--warn">${cellMoney(Math.max(0, totalPrev - totalPago))}</td>
          <td colspan="4"></td>
        </tr>`;
    }

    const n = ativas.length;
    if (els.summary) {
      const selHint = selectedIds.size ? ` — ${selectedIds.size} selecionada(s)` : '';
      const editHint = inlineEditId ? ' — ajuste fornecedor e valores na linha destacada' : '';
      els.summary.textContent = `${n} conta${n === 1 ? '' : 's'} ativa${n === 1 ? '' : 's'} — clique na linha para editar ou use Duplicar${selHint}${editHint}`;
    }

    totais = summarizeFromContas(contas);
    renderKpis();
    updateSelectionUi();
  }

  async function openModal(conta = null) {
    editId = conta?.id ?? null;
    showFormErrors(null);

    if (!categorias.length) {
      const catRes = await fetchFinanceiroCategorias();
      categorias = catRes?.categorias || [];
    }
    const planoRes = await fetchFinanceiroPlanoContas();
    planoContas = planoRes?.planoContas || [];

    refreshCategoriaDatalist();

    if (els.modalTitle) {
      els.modalTitle.textContent = editId ? 'Editar conta a pagar' : 'Nova conta a pagar';
    }
    if (els.modalSub) {
      els.modalSub.textContent = editId
        ? 'Atualize classificação, valores e status desta conta.'
        : 'Classifique o custo, informe valores e acompanhe pagamentos deste evento.';
    }
    if (els.fieldCategoria) els.fieldCategoria.value = conta?.categoriaNome || '';
    if (els.fieldPlano) {
      els.fieldPlano.value = conta
        ? conta.planoContaNome || planoLabel({ codigo: conta.planoContaCodigo, nome: conta.planoContaNome })
        : '';
    }
    refreshPlanoDatalist(conta?.categoriaNome || '');
    if (els.fieldFornecedor) els.fieldFornecedor.value = conta?.fornecedor || '';
    if (els.fieldDescricao) els.fieldDescricao.value = conta?.descricao || '';
    const qtd =
      conta?.quantidadePrevista != null ? Number(conta.quantidadePrevista) : 1;
    if (els.fieldQuantidadePrevista) {
      els.fieldQuantidadePrevista.value = String(qtd);
    }
    if (els.fieldValorPrevisto) {
      els.fieldValorPrevisto.value =
        conta?.valorPrevisto != null ? formatValorInput(conta.valorPrevisto) : '';
    }
    if (els.fieldValorUnitario) {
      const prev = conta?.valorPrevisto;
      const unit =
        conta?.valorUnitario ?? (prev != null && qtd > 0 ? calcValorUnitario(prev, qtd) : null);
      els.fieldValorUnitario.value = unit != null ? formatValorInput(unit) : '';
    }
    if (els.fieldValorPago) {
      els.fieldValorPago.value = conta?.valorPago != null ? formatValorInput(conta.valorPago) : '';
    }
    if (els.fieldDtVencimento) {
      els.fieldDtVencimento.value = toDateInputValue(conta?.dtVencimento);
    }
    if (els.fieldDtPagamento) {
      els.fieldDtPagamento.value = toDateInputValue(conta?.dtPagamento);
    }
    if (els.fieldStatus) els.fieldStatus.value = conta?.status || 'pendente';
    if (els.fieldObs) els.fieldObs.value = conta?.obs || '';
    if (els.fieldBonificado) els.fieldBonificado.checked = Boolean(conta?.bonificado);
    if (els.fieldBonificadoRef) els.fieldBonificadoRef.value = conta?.bonificadoRef || '';
    updateBonificadoRefVisibility();

    els.btnDelete?.classList.toggle('hidden', !editId);
    hideDraftUi();
    if (!editId) {
      const draft = readContasPagarDraft();
      if (draft) {
        applyDraftSnapshot(draft);
        showDraftRestoredUi();
      }
    }
    els.modalBg?.classList.add('open');
    els.fieldCategoria?.focus();
  }

  function closeModal() {
    flushDraftSave();
    cancelDraftSaveTimer();
    editId = null;
    hideDraftUi();
    showFormErrors(null);
    els.modalBg?.classList.remove('open');
  }

  function readFormFields() {
    return {
      categoriaNome: normalizeNome(els.fieldCategoria?.value),
      planoNome: normalizeNome(els.fieldPlano?.value),
      fornecedor: els.fieldFornecedor?.value?.trim() || '',
      descricao: els.fieldDescricao?.value?.trim() || '',
      quantidadePrevista: readQtyInput(els.fieldQuantidadePrevista),
      valorPrevisto: readMoneyInput(els.fieldValorPrevisto),
      valorPago: readMoneyInput(els.fieldValorPago),
      dtVencimento: els.fieldDtVencimento?.value?.trim() || '',
      dtPagamento: els.fieldDtPagamento?.value?.trim() || '',
      status: els.fieldStatus?.value || 'pendente',
      obs: els.fieldObs?.value?.trim() || '',
      bonificado: Boolean(els.fieldBonificado?.checked),
      bonificadoRef: els.fieldBonificadoRef?.value?.trim() || '',
    };
  }

  function collectDraftSnapshot() {
    return {
      categoriaNome: els.fieldCategoria?.value ?? '',
      planoNome: els.fieldPlano?.value ?? '',
      fornecedor: els.fieldFornecedor?.value ?? '',
      descricao: els.fieldDescricao?.value ?? '',
      quantidadePrevista: els.fieldQuantidadePrevista?.value ?? '',
      valorUnitario: els.fieldValorUnitario?.value ?? '',
      valorPrevisto: els.fieldValorPrevisto?.value ?? '',
      valorPago: els.fieldValorPago?.value ?? '',
      dtVencimento: els.fieldDtVencimento?.value ?? '',
      dtPagamento: els.fieldDtPagamento?.value ?? '',
      status: els.fieldStatus?.value || 'pendente',
      obs: els.fieldObs?.value ?? '',
      bonificado: Boolean(els.fieldBonificado?.checked),
      bonificadoRef: els.fieldBonificadoRef?.value ?? '',
      lastEditedValor,
    };
  }

  function isDraftSnapshotEmpty(snapshot) {
    const qtd = String(snapshot.quantidadePrevista ?? '').trim();
    return (
      !normalizeNome(snapshot.categoriaNome) &&
      !normalizeNome(snapshot.planoNome) &&
      !String(snapshot.fornecedor ?? '').trim() &&
      !String(snapshot.descricao ?? '').trim() &&
      !String(snapshot.valorUnitario ?? '').trim() &&
      !String(snapshot.valorPrevisto ?? '').trim() &&
      !String(snapshot.valorPago ?? '').trim() &&
      !String(snapshot.dtVencimento ?? '').trim() &&
      !String(snapshot.dtPagamento ?? '').trim() &&
      !String(snapshot.obs ?? '').trim() &&
      !snapshot.bonificado &&
      !String(snapshot.bonificadoRef ?? '').trim() &&
      (!qtd || qtd === '1') &&
      (snapshot.status || 'pendente') === 'pendente'
    );
  }

  function applyDraftSnapshot(draft) {
    draftRestoring = true;
    try {
      if (els.fieldCategoria) els.fieldCategoria.value = draft.categoriaNome ?? '';
      if (els.fieldPlano) els.fieldPlano.value = draft.planoNome ?? '';
      refreshPlanoDatalist(draft.categoriaNome ?? '');
      if (els.fieldFornecedor) els.fieldFornecedor.value = draft.fornecedor ?? '';
      if (els.fieldDescricao) els.fieldDescricao.value = draft.descricao ?? '';
      if (els.fieldQuantidadePrevista) {
        els.fieldQuantidadePrevista.value =
          draft.quantidadePrevista != null && String(draft.quantidadePrevista).trim()
            ? String(draft.quantidadePrevista)
            : '1';
      }
      if (els.fieldValorUnitario) els.fieldValorUnitario.value = draft.valorUnitario ?? '';
      if (els.fieldValorPrevisto) els.fieldValorPrevisto.value = draft.valorPrevisto ?? '';
      if (els.fieldValorPago) els.fieldValorPago.value = draft.valorPago ?? '';
      if (els.fieldDtVencimento) els.fieldDtVencimento.value = draft.dtVencimento ?? '';
      if (els.fieldDtPagamento) els.fieldDtPagamento.value = draft.dtPagamento ?? '';
      if (els.fieldStatus) els.fieldStatus.value = draft.status || 'pendente';
      if (els.fieldObs) els.fieldObs.value = draft.obs ?? '';
      if (els.fieldBonificado) els.fieldBonificado.checked = Boolean(draft.bonificado);
      if (els.fieldBonificadoRef) els.fieldBonificadoRef.value = draft.bonificadoRef ?? '';
      updateBonificadoRefVisibility();
      lastEditedValor = draft.lastEditedValor ?? null;
    } finally {
      draftRestoring = false;
    }
  }

  function resetNewFormDefaults() {
    draftRestoring = true;
    try {
      if (els.fieldCategoria) els.fieldCategoria.value = '';
      if (els.fieldPlano) els.fieldPlano.value = '';
      refreshPlanoDatalist('');
      if (els.fieldFornecedor) els.fieldFornecedor.value = '';
      if (els.fieldDescricao) els.fieldDescricao.value = '';
      if (els.fieldQuantidadePrevista) els.fieldQuantidadePrevista.value = '1';
      if (els.fieldValorUnitario) els.fieldValorUnitario.value = '';
      if (els.fieldValorPrevisto) els.fieldValorPrevisto.value = '';
      if (els.fieldValorPago) els.fieldValorPago.value = '';
      if (els.fieldDtVencimento) els.fieldDtVencimento.value = '';
      if (els.fieldDtPagamento) els.fieldDtPagamento.value = '';
      if (els.fieldStatus) els.fieldStatus.value = 'pendente';
      if (els.fieldObs) els.fieldObs.value = '';
      if (els.fieldBonificado) els.fieldBonificado.checked = false;
      if (els.fieldBonificadoRef) els.fieldBonificadoRef.value = '';
      updateBonificadoRefVisibility();
      lastEditedValor = null;
    } finally {
      draftRestoring = false;
    }
  }

  function hideDraftUi() {
    els.draftHint?.classList.add('hidden');
    els.draftDiscard?.classList.add('hidden');
  }

  function showDraftRestoredUi() {
    if (els.draftHint) {
      els.draftHint.textContent = 'Continuando preenchimento anterior';
      els.draftHint.classList.remove('hidden');
    }
    els.draftDiscard?.classList.remove('hidden');
  }

  function cancelDraftSaveTimer() {
    if (draftSaveTimer != null) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
  }

  function flushDraftSave() {
    if (editId != null || draftRestoring || !els.modalBg?.classList.contains('open')) return;
    const snapshot = collectDraftSnapshot();
    if (isDraftSnapshotEmpty(snapshot)) {
      clearContasPagarDraft();
      return;
    }
    writeContasPagarDraft(snapshot);
  }

  function scheduleDraftSave() {
    if (editId != null || draftRestoring || !els.modalBg?.classList.contains('open')) return;
    cancelDraftSaveTimer();
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      flushDraftSave();
    }, DRAFT_SAVE_DEBOUNCE_MS);
  }

  function discardDraft() {
    clearContasPagarDraft();
    hideDraftUi();
    if (editId == null) resetNewFormDefaults();
  }

  async function loadContasPagar() {
    if (loading) return;
    loading = true;
    try {
      const [catRes, contasRes, planoRes] = await Promise.all([
        fetchFinanceiroCategorias(),
        fetchContasPagar(),
        fetchFinanceiroPlanoContas(),
      ]);
      categorias = catRes?.categorias || [];
      contas = contasRes?.contas || [];
      totais = contasRes?.totais || summarizeFromContas(contas);
      planoContas = planoRes?.planoContas || [];
      inlineEditId = null;
      renderTable();
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Falha ao carregar.';
    } finally {
      loading = false;
    }
  }

  async function saveConta() {
    const fields = readFormFields();
    if (!fields.categoriaNome) {
      showFormErrors('Informe a categoria.');
      els.fieldCategoria?.focus();
      return;
    }
    if (!fields.planoNome) {
      showFormErrors('Informe o plano de contas.');
      els.fieldPlano?.focus();
      return;
    }
    if (!fields.descricao) {
      showFormErrors('Informe a descrição.');
      els.fieldDescricao?.focus();
      return;
    }
    if (!fields.quantidadePrevista || fields.quantidadePrevista <= 0) {
      showFormErrors('Informe a quantidade prevista (maior que zero).');
      els.fieldQuantidadePrevista?.focus();
      return;
    }
    if (!fields.valorPrevisto) {
      showFormErrors('Informe o valor previsto total.');
      els.fieldValorPrevisto?.focus();
      return;
    }

    showFormErrors(null);
    els.btnSave.disabled = true;
    try {
      const categoriaId = await resolveCategoriaId(fields.categoriaNome);
      if (!categoriaId) {
        showFormErrors('Não foi possível salvar a categoria.');
        return;
      }
      const planoContaId = await resolvePlanoContaId(categoriaId, fields.planoNome);
      if (!planoContaId) {
        showFormErrors('Não foi possível salvar o plano de contas.');
        return;
      }

      const data = {
        categoriaId,
        planoContaId,
        fornecedor: fields.fornecedor,
        descricao: fields.descricao,
        quantidadePrevista: fields.quantidadePrevista,
        valorPrevisto: fields.valorPrevisto,
        valorPago: fields.valorPago,
        dtVencimento: fields.dtVencimento,
        dtPagamento: fields.dtPagamento,
        status: fields.status,
        obs: fields.obs,
        bonificado: fields.bonificado,
        bonificadoRef: fields.bonificado ? fields.bonificadoRef : '',
      };

      if (editId) {
        const { conta } = await updateContaPagar(editId, data);
        const idx = contas.findIndex((c) => c.id === editId);
        if (idx >= 0 && conta) contas[idx] = conta;
      } else {
        const { conta } = await createContaPagar(data);
        if (conta) contas.push(conta);
        cancelDraftSaveTimer();
        clearContasPagarDraft();
      }
      closeModal();
      renderTable();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
    }
  }

  async function duplicateConta(source) {
    if (duplicating) return;
    duplicating = true;
    try {
      const data = contaToPayload(source, {
        valorPago: 0,
        dtPagamento: '',
        status: 'pendente',
      });
      const { conta } = await createContaPagar(data);
      if (conta) {
        contas.push(conta);
        inlineEditId = conta.id;
        renderTable();
      }
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Não foi possível duplicar.';
    } finally {
      duplicating = false;
    }
  }

  function readInlineFields(tr) {
    return {
      fornecedor: tr.querySelector('[data-field="fornecedor"]')?.value.trim() || '',
      quantidadePrevista: readQtyInput(tr.querySelector('[data-field="quantidadePrevista"]')),
      valorPrevisto: readMoneyInput(tr.querySelector('[data-field="valorPrevisto"]')),
      valorPago: readMoneyInput(tr.querySelector('[data-field="valorPago"]')),
    };
  }

  async function saveInlineEdit(id) {
    const tr = els.table?.querySelector(`tr[data-id="${id}"]`);
    const conta = contas.find((c) => c.id === id);
    if (!tr || !conta) return;

    const fields = readInlineFields(tr);
    if (!fields.quantidadePrevista || fields.quantidadePrevista <= 0) {
      if (els.summary) els.summary.textContent = 'Informe a quantidade prevista na linha em edição.';
      tr.querySelector('[data-field="quantidadePrevista"]')?.focus();
      return;
    }
    if (!fields.valorPrevisto) {
      if (els.summary) els.summary.textContent = 'Informe o valor previsto na linha em edição.';
      tr.querySelector('[data-field="valorPrevisto"]')?.focus();
      return;
    }

    try {
      const data = contaToPayload(conta, {
        fornecedor: fields.fornecedor,
        quantidadePrevista: fields.quantidadePrevista,
        valorPrevisto: fields.valorPrevisto,
        valorPago: fields.valorPago,
      });
      const { conta: updated } = await updateContaPagar(id, data);
      const idx = contas.findIndex((c) => c.id === id);
      if (idx >= 0 && updated) contas[idx] = updated;
      inlineEditId = null;
      renderTable();
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Não foi possível salvar.';
    }
  }

  function cancelInlineEdit() {
    inlineEditId = null;
    renderTable();
  }

  async function removeConta() {
    if (!editId) return;
    const conta = contas.find((c) => c.id === editId);
    const label = conta?.descricao || 'esta conta';
    const ok = window.confirm(`Excluir "${label}"?`);
    if (!ok) return;
    try {
      await deleteContaPagar(editId);
      contas = contas.filter((c) => c.id !== editId);
      closeModal();
      renderTable();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível excluir.');
    }
  }

  function showBulkErrors(messages) {
    if (!els.bulkModalErrors) return;
    const list = Array.isArray(messages) ? messages : [messages];
    const text = list
      .map((m) => (typeof m === 'string' ? m : m?.message))
      .filter(Boolean)
      .join(' ');
    if (!text) {
      els.bulkModalErrors.classList.add('hidden');
      els.bulkModalErrors.textContent = '';
      return;
    }
    els.bulkModalErrors.textContent = text;
    els.bulkModalErrors.classList.remove('hidden');
  }

  function openBulkValoresModal() {
    const ids = [...selectedIds];
    if (!ids.length || bulkUpdating) return;

    if (els.bulkModalSub) {
      els.bulkModalSub.textContent =
        ids.length === 1
          ? '1 conta selecionada — preencha um ou ambos os campos.'
          : `${ids.length} contas selecionadas — preencha um ou ambos os campos.`;
    }
    if (els.bulkValorPrevisto) els.bulkValorPrevisto.value = '';
    if (els.bulkQuantidade) els.bulkQuantidade.value = '';
    showBulkErrors(null);
    els.bulkModalBg?.classList.add('open');
    els.bulkValorPrevisto?.focus();
  }

  function closeBulkValoresModal() {
    showBulkErrors(null);
    els.bulkModalBg?.classList.remove('open');
  }

  async function applyBulkValores() {
    const ids = [...selectedIds];
    if (!ids.length || bulkUpdating) return;

    const valorRaw = els.bulkValorPrevisto?.value?.trim() || '';
    const qtdRaw = els.bulkQuantidade?.value?.trim() || '';
    const fields = {};

    if (valorRaw) {
      const valorPrevisto = parseValor(valorRaw);
      if (!valorPrevisto || valorPrevisto <= 0) {
        showBulkErrors('Informe um valor previsto maior que zero.');
        els.bulkValorPrevisto?.focus();
        return;
      }
      fields.valorPrevisto = valorPrevisto;
    }

    if (qtdRaw) {
      const quantidadePrevista = readQtyInput(els.bulkQuantidade);
      if (!quantidadePrevista || quantidadePrevista <= 0) {
        showBulkErrors('Informe uma quantidade prevista maior que zero.');
        els.bulkQuantidade?.focus();
        return;
      }
      fields.quantidadePrevista = quantidadePrevista;
    }

    if (!Object.keys(fields).length) {
      showBulkErrors('Informe o valor previsto e/ou a quantidade para aplicar.');
      els.bulkValorPrevisto?.focus();
      return;
    }

    const parts = [];
    if (fields.valorPrevisto != null) parts.push(`valor previsto ${fmtMoney(fields.valorPrevisto)}`);
    if (fields.quantidadePrevista != null) parts.push(`quantidade ${fields.quantidadePrevista}`);
    const detail = parts.join(' e ');

    if (ids.length > 5) {
      const ok = window.confirm(`Aplicar ${detail} em ${ids.length} contas?`);
      if (!ok) return;
    }

    bulkUpdating = true;
    if (els.btnBulkApply) els.btnBulkApply.disabled = true;
    updateSelectionUi();
    try {
      const result = await bulkUpdateContasPagar(ids, fields);
      contas = result?.contas || contas;
      totais = result?.totais || summarizeFromContas(contas);
      inlineEditId = null;
      clearSelection();
      closeBulkValoresModal();
      renderTable();
      if (els.summary && result?.updated != null) {
        const n = result.updated;
        els.summary.textContent = `${n} conta${n === 1 ? '' : 's'} atualizada${n === 1 ? '' : 's'} — ${detail}.`;
      }
    } catch (err) {
      showBulkErrors(err.message || 'Não foi possível aplicar a alteração.');
    } finally {
      bulkUpdating = false;
      if (els.btnBulkApply) els.btnBulkApply.disabled = false;
      updateSelectionUi();
    }
  }

  async function bulkSetFase(fase) {
    const ids = [...selectedIds];
    if (!ids.length || bulkUpdating) return;

    const label = FASE_LABEL[fase] || fase;
    if (ids.length > 5) {
      const ok = window.confirm(`Alterar a fase de ${ids.length} contas para ${label}?`);
      if (!ok) return;
    }

    bulkUpdating = true;
    updateSelectionUi();
    try {
      const result = await bulkUpdateContasPagarFase(ids, fase);
      contas = result?.contas || contas;
      totais = result?.totais || summarizeFromContas(contas);
      inlineEditId = null;
      clearSelection();
      renderTable();
      if (els.summary && result?.updated != null) {
        const n = result.updated;
        els.summary.textContent = `${n} conta${n === 1 ? '' : 's'} marcada${n === 1 ? '' : 's'} como ${label}.`;
      }
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Não foi possível alterar a fase.';
    } finally {
      bulkUpdating = false;
      updateSelectionUi();
    }
  }

  els.fieldCategoria?.addEventListener('input', () => {
    refreshPlanoDatalist(els.fieldCategoria.value);
  });

  els.fieldBonificado?.addEventListener('change', () => {
    updateBonificadoRefVisibility();
    scheduleDraftSave();
  });

  els.fieldDtVencimento?.addEventListener('change', scheduleDraftSave);
  els.fieldDtPagamento?.addEventListener('change', scheduleDraftSave);

  const draftFieldEls = [
    els.fieldCategoria,
    els.fieldPlano,
    els.fieldFornecedor,
    els.fieldDescricao,
    els.fieldQuantidadePrevista,
    els.fieldValorUnitario,
    els.fieldValorPrevisto,
    els.fieldValorPago,
    els.fieldDtVencimento,
    els.fieldDtPagamento,
    els.fieldStatus,
    els.fieldObs,
    els.fieldBonificadoRef,
  ];
  draftFieldEls.filter(Boolean).forEach((el) => {
    el.addEventListener('input', scheduleDraftSave);
    el.addEventListener('change', scheduleDraftSave);
  });

  els.draftDiscard?.addEventListener('click', discardDraft);

  els.btnNew?.addEventListener('click', () => void openModal());
  els.chkAll?.addEventListener('change', (e) => toggleSelectAll(e.target.checked));
  els.btnClearSelection?.addEventListener('click', clearSelection);
  els.btnFasePre?.addEventListener('click', () => void bulkSetFase('pre'));
  els.btnFasePos?.addEventListener('click', () => void bulkSetFase('pos'));
  els.btnBulkValores?.addEventListener('click', openBulkValoresModal);
  els.btnBulkCancel?.addEventListener('click', closeBulkValoresModal);
  els.btnBulkApply?.addEventListener('click', () => void applyBulkValores());
  els.bulkModalBg?.addEventListener('click', (e) => {
    if (e.target === els.bulkModalBg) closeBulkValoresModal();
  });
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveConta());
  els.btnDelete?.addEventListener('click', () => void removeConta());

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.table?.addEventListener('change', (e) => {
    if (e.target.matches('.row-chk')) {
      toggleSelect(Number(e.target.dataset.id), e.target.checked);
    }
  });

  els.table?.addEventListener('click', (e) => {
    if (e.target.closest('.chk-cell')) {
      e.stopPropagation();
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const tr = actionBtn.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      const action = actionBtn.dataset.action;
      if (action === 'duplicate') {
        const conta = contas.find((c) => c.id === id);
        if (conta) void duplicateConta(conta);
        return;
      }
      if (action === 'inline-save') {
        void saveInlineEdit(id);
        return;
      }
      if (action === 'inline-cancel') {
        cancelInlineEdit();
      }
      return;
    }

    if (e.target.closest('.fin-inline-input')) return;

    const tr = e.target.closest('tr[data-id]');
    if (!tr || tr.classList.contains('fin-custo-row--editing')) return;
    const conta = contas.find((c) => c.id === Number(tr.dataset.id));
    if (conta) void openModal(conta);
  });

  els.table?.addEventListener('keydown', (e) => {
    if (e.target.matches('.fin-inline-input') && e.key === 'Enter') {
      e.preventDefault();
      const tr = e.target.closest('tr[data-id]');
      if (tr) void saveInlineEdit(Number(tr.dataset.id));
      return;
    }

    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr || tr.classList.contains('fin-custo-row--editing')) return;
    e.preventDefault();
    const conta = contas.find((c) => c.id === Number(tr.dataset.id));
    if (conta) void openModal(conta);
  });

  els.table?.addEventListener('focusout', (e) => {
    const tr = e.target.closest('tr.fin-custo-row--editing');
    if (!tr || !e.target.matches('.fin-inline-input')) return;
    requestAnimationFrame(() => {
      if (tr.contains(document.activeElement)) return;
      void saveInlineEdit(Number(tr.dataset.id));
    });
  });

  contasPagarInstance = { loadContasPagar };
  return contasPagarInstance;
}
