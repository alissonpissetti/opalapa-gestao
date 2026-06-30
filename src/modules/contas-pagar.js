import {
  fetchFinanceiroCategorias,
  fetchFinanceiroPlanoContas,
  fetchContasPagar,
  createContaPagar,
  updateContaPagar,
  deleteContaPagar,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, formatValorInput, maskValorInput, parseValor } from '../lib/format.js';

const STATUS_LABEL = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

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

let contasPagarInstance = null;

export function initContasPagarModule() {
  if (contasPagarInstance) return contasPagarInstance;

  const els = {
    summary: document.getElementById('contas-pagar-summary'),
    empty: document.getElementById('contas-pagar-empty'),
    tableWrap: document.getElementById('contas-pagar-table-wrap'),
    table: document.getElementById('contas-pagar-table'),
    tableFoot: document.getElementById('contas-pagar-table-foot'),
    btnNew: document.getElementById('btn-contas-pagar-new'),
    modalBg: document.getElementById('contas-pagar-modal-bg'),
    modalTitle: document.getElementById('contas-pagar-modal-title'),
    formErrors: document.getElementById('contas-pagar-modal-errors'),
    fieldCategoria: document.getElementById('contas-pagar-modal-categoria'),
    fieldPlano: document.getElementById('contas-pagar-modal-plano'),
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
  let editId = null;
  let loading = false;

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

  function fillCategoriaSelect(selectedId = '') {
    if (!els.fieldCategoria) return;
    els.fieldCategoria.innerHTML =
      '<option value="">Selecione…</option>' +
      categorias
        .map(
          (c) =>
            `<option value="${c.id}"${Number(selectedId) === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
        )
        .join('');
  }

  function fillPlanoSelect(categoriaId, selectedId = '') {
    if (!els.fieldPlano) return;
    const filtered = categoriaId
      ? planoContas.filter((p) => p.categoriaId === Number(categoriaId))
      : [];
    els.fieldPlano.innerHTML =
      '<option value="">Selecione…</option>' +
      filtered
        .map(
          (p) =>
            `<option value="${p.id}"${Number(selectedId) === p.id ? ' selected' : ''}>${escapeHtml(planoLabel(p))}</option>`,
        )
        .join('');
    els.fieldPlano.disabled = !categoriaId;
  }

  async function loadPlanoContas(categoriaId) {
    const res = await fetchFinanceiroPlanoContas(categoriaId ? { categoriaId } : {});
    planoContas = res?.planoContas || [];
    fillPlanoSelect(categoriaId, els.fieldPlano?.value);
  }

  function statusBadge(status) {
    const label = STATUS_LABEL[status] || status;
    return `<span class="fin-status fin-status--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
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
      return;
    }

    let totalPrev = 0;
    let totalPago = 0;

    els.table.innerHTML = contas
      .map((c) => {
        const prev = Number(c.valorPrevisto) || 0;
        const pago = Number(c.valorPago) || 0;
        const falta = Math.max(0, prev - pago);
        if (c.status !== 'cancelado') {
          totalPrev += prev;
          totalPago += pago;
        }
        const plano = [c.planoContaCodigo, c.planoContaNome].filter(Boolean).join(' — ');
        return `
      <tr class="fin-custo-row" data-id="${c.id}" tabindex="0" role="button" title="Clique para editar">
        <td class="fin-custo-cat">${escapeHtml(c.categoriaNome || '—')}</td>
        <td class="fin-col-plano">${escapeHtml(plano || '—')}</td>
        <td>${escapeHtml(c.fornecedor || '—')}</td>
        <td>${escapeHtml(c.descricao || '—')}</td>
        <td class="fin-col-money">${cellMoney(prev)}</td>
        <td class="fin-col-money fin-val--pos">${cellMoney(pago)}</td>
        <td class="fin-col-money fin-val--warn">${cellMoney(falta)}</td>
        <td>${statusBadge(c.status)}</td>
        <td>${escapeHtml(c.dtVencimento || '—')}</td>
      </tr>`;
      })
      .join('');

    if (els.tableFoot) {
      els.tableFoot.innerHTML = `
        <tr class="fin-custo-total">
          <td colspan="4">Total (exc. canceladas)</td>
          <td class="fin-col-money">${cellMoney(totalPrev)}</td>
          <td class="fin-col-money fin-val--pos">${cellMoney(totalPago)}</td>
          <td class="fin-col-money fin-val--warn">${cellMoney(Math.max(0, totalPrev - totalPago))}</td>
          <td colspan="2"></td>
        </tr>`;
    }

    const n = ativas.length;
    if (els.summary) {
      els.summary.textContent = `${n} conta${n === 1 ? '' : 's'} ativa${n === 1 ? '' : 's'} — clique na linha para editar`;
    }
  }

  async function openModal(conta = null) {
    editId = conta?.id ?? null;
    showFormErrors(null);

    if (!categorias.length) {
      const catRes = await fetchFinanceiroCategorias();
      categorias = catRes?.categorias || [];
    }
    await loadPlanoContas(conta?.categoriaId || '');

    fillCategoriaSelect(conta?.categoriaId || '');
    fillPlanoSelect(conta?.categoriaId || '', conta?.planoContaId || '');

    if (els.modalTitle) {
      els.modalTitle.textContent = editId ? 'Editar conta a pagar' : 'Nova conta a pagar';
    }
    if (els.fieldFornecedor) els.fieldFornecedor.value = conta?.fornecedor || '';
    if (els.fieldDescricao) els.fieldDescricao.value = conta?.descricao || '';
    if (els.fieldValorPrevisto) {
      els.fieldValorPrevisto.value =
        conta?.valorPrevisto != null ? formatValorInput(conta.valorPrevisto) : '';
    }
    if (els.fieldValorPago) {
      els.fieldValorPago.value = conta?.valorPago != null ? formatValorInput(conta.valorPago) : '';
    }
    if (els.fieldDtVencimento) els.fieldDtVencimento.value = conta?.dtVencimento || '';
    if (els.fieldDtPagamento) els.fieldDtPagamento.value = conta?.dtPagamento || '';
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

  function readForm() {
    return {
      categoriaId: Number(els.fieldCategoria?.value) || null,
      planoContaId: Number(els.fieldPlano?.value) || null,
      fornecedor: els.fieldFornecedor?.value?.trim() || '',
      descricao: els.fieldDescricao?.value?.trim() || '',
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
      const [catRes, contasRes] = await Promise.all([
        fetchFinanceiroCategorias(),
        fetchContasPagar(),
      ]);
      categorias = catRes?.categorias || [];
      contas = contasRes?.contas || [];
      const planoRes = await fetchFinanceiroPlanoContas();
      planoContas = planoRes?.planoContas || [];
      renderTable();
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Falha ao carregar.';
    } finally {
      loading = false;
    }
  }

  async function saveConta() {
    const data = readForm();
    if (!data.categoriaId) {
      showFormErrors('Selecione a categoria.');
      els.fieldCategoria?.focus();
      return;
    }
    if (!data.planoContaId) {
      showFormErrors('Selecione o plano de contas.');
      els.fieldPlano?.focus();
      return;
    }
    if (!data.descricao) {
      showFormErrors('Informe a descrição.');
      els.fieldDescricao?.focus();
      return;
    }
    if (!data.valorPrevisto) {
      showFormErrors('Informe o valor previsto.');
      els.fieldValorPrevisto?.focus();
      return;
    }

    showFormErrors(null);
    els.btnSave.disabled = true;
    try {
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

  els.fieldCategoria?.addEventListener('change', async () => {
    const catId = els.fieldCategoria.value;
    await loadPlanoContas(catId);
    fillPlanoSelect(catId);
  });

  els.btnNew?.addEventListener('click', () => void openModal());
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveConta());
  els.btnDelete?.addEventListener('click', () => void removeConta());

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.table?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const conta = contas.find((c) => c.id === Number(tr.dataset.id));
    if (conta) void openModal(conta);
  });

  els.table?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    const conta = contas.find((c) => c.id === Number(tr.dataset.id));
    if (conta) void openModal(conta);
  });

  contasPagarInstance = { loadContasPagar };
  return contasPagarInstance;
}
