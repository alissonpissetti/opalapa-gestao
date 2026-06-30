import {
  fetchFinanceiroCategorias,
  fetchFinanceiroPlanoContas,
  fetchContasPagar,
  createFinanceiroCategoria,
  createFinanceiroPlanoConta,
  createContaPagar,
  updateContaPagar,
  deleteContaPagar,
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
    modalBg: document.getElementById('contas-pagar-modal-bg'),
    modalTitle: document.getElementById('contas-pagar-modal-title'),
    modalSub: document.getElementById('contas-pagar-modal-sub'),
    formErrors: document.getElementById('contas-pagar-modal-errors'),
    fieldCategoria: document.getElementById('contas-pagar-modal-categoria'),
    fieldPlano: document.getElementById('contas-pagar-modal-plano'),
    fieldFase: document.getElementById('contas-pagar-modal-fase'),
    datalistCategorias: document.getElementById('contas-pagar-categorias-list'),
    datalistPlano: document.getElementById('contas-pagar-plano-list'),
    fieldFornecedor: document.getElementById('contas-pagar-modal-fornecedor'),
    fieldDescricao: document.getElementById('contas-pagar-modal-descricao'),
    fieldValorPrevisto: document.getElementById('contas-pagar-modal-valor-previsto'),
    fieldValorPago: document.getElementById('contas-pagar-modal-valor-pago'),
    fieldDtVencimento: document.getElementById('contas-pagar-modal-dt-vencimento'),
    fieldDtPagamento: document.getElementById('contas-pagar-modal-dt-pagamento'),
    fieldStatus: document.getElementById('contas-pagar-modal-status'),
    fieldObs: document.getElementById('contas-pagar-modal-obs'),
    btnCancel: document.getElementById('contas-pagar-modal-cancel'),
    btnSave: document.getElementById('contas-pagar-modal-save'),
    btnDelete: document.getElementById('contas-pagar-modal-delete'),
  };

  [els.fieldValorPrevisto, els.fieldValorPago].filter(Boolean).forEach((input) => {
    input.addEventListener('input', () => maskValorInput(input));
  });

  let contas = [];
  let categorias = [];
  let planoContas = [];
  let totais = summarizeFromContas([]);
  let editId = null;
  let inlineEditId = null;
  let loading = false;
  let duplicating = false;

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

  function contaToPayload(conta, overrides = {}) {
    return {
      categoriaId: conta.categoriaId,
      planoContaId: conta.planoContaId,
      fornecedor: overrides.fornecedor ?? conta.fornecedor ?? '',
      descricao: conta.descricao,
      fase: overrides.fase ?? (conta.fase === 'pos' ? 'pos' : 'pre'),
      valorPrevisto: overrides.valorPrevisto ?? conta.valorPrevisto,
      valorPago: overrides.valorPago ?? conta.valorPago ?? 0,
      dtVencimento: conta.dtVencimento || '',
      dtPagamento: overrides.dtPagamento ?? conta.dtPagamento ?? '',
      status: overrides.status ?? conta.status ?? 'pendente',
      obs: conta.obs || '',
    };
  }

  function renderInlineRow(c) {
    const prev = Number(c.valorPrevisto) || 0;
    const pago = Number(c.valorPago) || 0;
    const falta = Math.max(0, prev - pago);
    const plano = [c.planoContaCodigo, c.planoContaNome].filter(Boolean).join(' — ');
    return `
      <tr class="fin-custo-row fin-custo-row--editing" data-id="${c.id}">
        <td class="fin-custo-cat">${escapeHtml(c.categoriaNome || '—')}</td>
        <td class="fin-col-plano">${escapeHtml(plano || '—')}</td>
        <td><input type="text" class="fin-inline-input" data-field="fornecedor" value="${escapeHtml(c.fornecedor || '')}" placeholder="Fornecedor" autocomplete="off" /></td>
        <td>${escapeHtml(c.descricao || '—')}</td>
        <td>${faseBadge(c.fase)}</td>
        <td class="fin-col-money"><input type="text" class="fin-inline-input fin-inline-money" data-field="valorPrevisto" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(prev))}" /></td>
        <td class="fin-col-money"><input type="text" class="fin-inline-input fin-inline-money fin-val--pos" data-field="valorPago" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(pago))}" /></td>
        <td class="fin-col-money fin-val--warn">${cellMoney(falta)}</td>
        <td>${statusBadge(c.status)}</td>
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
    const falta = Math.max(0, prev - pago);
    const plano = [c.planoContaCodigo, c.planoContaNome].filter(Boolean).join(' — ');
    return `
      <tr class="fin-custo-row" data-id="${c.id}" tabindex="0" role="button" title="Clique para editar">
        <td class="fin-custo-cat">${escapeHtml(c.categoriaNome || '—')}</td>
        <td class="fin-col-plano">${escapeHtml(plano || '—')}</td>
        <td>${escapeHtml(c.fornecedor || '—')}</td>
        <td>${escapeHtml(c.descricao || '—')}</td>
        <td>${faseBadge(c.fase)}</td>
        <td class="fin-col-money">${cellMoney(prev)}</td>
        <td class="fin-col-money fin-val--pos">${cellMoney(pago)}</td>
        <td class="fin-col-money fin-val--warn">${cellMoney(falta)}</td>
        <td>${statusBadge(c.status)}</td>
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
      renderKpis();
      return;
    }

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
          <td colspan="5">Total (exc. canceladas)</td>
          <td class="fin-col-money">${cellMoney(totalPrev)}</td>
          <td class="fin-col-money fin-val--pos">${cellMoney(totalPago)}</td>
          <td class="fin-col-money fin-val--warn">${cellMoney(Math.max(0, totalPrev - totalPago))}</td>
          <td colspan="4"></td>
        </tr>`;
    }

    const n = ativas.length;
    if (els.summary) {
      const editHint = inlineEditId ? ' — ajuste fornecedor e valores na linha destacada' : '';
      els.summary.textContent = `${n} conta${n === 1 ? '' : 's'} ativa${n === 1 ? '' : 's'} — clique na linha para editar ou use Duplicar${editHint}`;
    }

    totais = summarizeFromContas(contas);
    renderKpis();
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
    if (els.fieldFase) els.fieldFase.value = conta?.fase === 'pos' ? 'pos' : 'pre';
    if (els.fieldValorPrevisto) {
      els.fieldValorPrevisto.value =
        conta?.valorPrevisto != null ? formatValorInput(conta.valorPrevisto) : '';
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

    els.btnDelete?.classList.toggle('hidden', !editId);
    els.modalBg?.classList.add('open');
    els.fieldCategoria?.focus();
  }

  function closeModal() {
    editId = null;
    showFormErrors(null);
    els.modalBg?.classList.remove('open');
  }

  function readFormFields() {
    return {
      categoriaNome: normalizeNome(els.fieldCategoria?.value),
      planoNome: normalizeNome(els.fieldPlano?.value),
      fornecedor: els.fieldFornecedor?.value?.trim() || '',
      descricao: els.fieldDescricao?.value?.trim() || '',
      fase: els.fieldFase?.value === 'pos' ? 'pos' : 'pre',
      valorPrevisto: readMoneyInput(els.fieldValorPrevisto),
      valorPago: readMoneyInput(els.fieldValorPago),
      dtVencimento: els.fieldDtVencimento?.value?.trim() || '',
      dtPagamento: els.fieldDtPagamento?.value?.trim() || '',
      status: els.fieldStatus?.value || 'pendente',
      obs: els.fieldObs?.value?.trim() || '',
    };
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
    if (!fields.valorPrevisto) {
      showFormErrors('Informe o valor previsto.');
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
        fase: fields.fase,
        valorPrevisto: fields.valorPrevisto,
        valorPago: fields.valorPago,
        dtVencimento: fields.dtVencimento,
        dtPagamento: fields.dtPagamento,
        status: fields.status,
        obs: fields.obs,
      };

      if (editId) {
        const { conta } = await updateContaPagar(editId, data);
        const idx = contas.findIndex((c) => c.id === editId);
        if (idx >= 0 && conta) contas[idx] = conta;
      } else {
        const { conta } = await createContaPagar(data);
        if (conta) contas.push(conta);
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
      valorPrevisto: readMoneyInput(tr.querySelector('[data-field="valorPrevisto"]')),
      valorPago: readMoneyInput(tr.querySelector('[data-field="valorPago"]')),
    };
  }

  async function saveInlineEdit(id) {
    const tr = els.table?.querySelector(`tr[data-id="${id}"]`);
    const conta = contas.find((c) => c.id === id);
    if (!tr || !conta) return;

    const fields = readInlineFields(tr);
    if (!fields.valorPrevisto) {
      if (els.summary) els.summary.textContent = 'Informe o valor previsto na linha em edição.';
      tr.querySelector('[data-field="valorPrevisto"]')?.focus();
      return;
    }

    try {
      const data = contaToPayload(conta, {
        fornecedor: fields.fornecedor,
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

  els.fieldCategoria?.addEventListener('input', () => {
    refreshPlanoDatalist(els.fieldCategoria.value);
  });

  els.btnNew?.addEventListener('click', () => void openModal());
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveConta());
  els.btnDelete?.addEventListener('click', () => void removeConta());

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.table?.addEventListener('click', (e) => {
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
