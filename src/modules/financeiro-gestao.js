import {
  fetchFinanceiroResultado,
  carregarModeloFinanceiroResultado,
  createFinanceiroLinha,
  updateFinanceiroLinha,
  deleteFinanceiroLinha,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, formatValorInput, maskValorInput, parseValor } from '../lib/format.js';

function cellMoney(val) {
  return fmtMoney(val);
}

function cellText(val) {
  const s = String(val ?? '').trim();
  return s ? escapeHtml(s) : '—';
}

function rowClass(tipo) {
  return `fin-row fin-row--${tipo || 'linha'}`;
}

function readMoneyInput(el) {
  if (!el) return null;
  const raw = el.value.trim();
  if (!raw) return null;
  return parseValor(raw);
}

let financeiroGestaoInstance = null;

export function initFinanceiroGestaoModule() {
  if (financeiroGestaoInstance) return financeiroGestaoInstance;
  const els = {
    summary: document.getElementById('financeiro-summary'),
    empty: document.getElementById('financeiro-empty'),
    tableWrap: document.getElementById('financeiro-table-wrap'),
    table: document.getElementById('financeiro-table'),
    btnNew: document.getElementById('btn-financeiro-new'),
    btnModelo: document.getElementById('btn-financeiro-modelo'),
    btnEmptyModelo: document.getElementById('btn-financeiro-empty-modelo'),
    modalBg: document.getElementById('financeiro-modal-bg'),
    modalTitle: document.getElementById('financeiro-modal-title'),
    modalSub: document.getElementById('financeiro-modal-sub'),
    formErrors: document.getElementById('financeiro-modal-errors'),
    fieldTipo: document.getElementById('financeiro-modal-tipo'),
    fieldItem: document.getElementById('financeiro-modal-item'),
    fieldOrcamentoCategoria: document.getElementById('financeiro-modal-orcamento-categoria'),
    fieldSubItem: document.getElementById('financeiro-modal-sub-item'),
    fieldPrevistoQtde: document.getElementById('financeiro-modal-previsto-qtde'),
    fieldDiaria: document.getElementById('financeiro-modal-diaria'),
    fieldOrcamento: document.getElementById('financeiro-modal-orcamento'),
    fieldValorUnit: document.getElementById('financeiro-modal-valor-unit'),
    fieldValorBonificado: document.getElementById('financeiro-modal-valor-bonificado'),
    fieldValorTotal: document.getElementById('financeiro-modal-valor-total'),
    fieldPreEvento: document.getElementById('financeiro-modal-pre-evento'),
    fieldPosEvento: document.getElementById('financeiro-modal-pos-evento'),
    fieldRealizadoPago: document.getElementById('financeiro-modal-realizado-pago'),
    fieldStatus: document.getElementById('financeiro-modal-status'),
    fieldDtPrevista: document.getElementById('financeiro-modal-dt-prevista'),
    fieldDtRealiz: document.getElementById('financeiro-modal-dt-realiz'),
    fieldQuem: document.getElementById('financeiro-modal-quem'),
    fieldReembolso: document.getElementById('financeiro-modal-reembolso'),
    btnCancel: document.getElementById('financeiro-modal-cancel'),
    btnSave: document.getElementById('financeiro-modal-save'),
    btnDelete: document.getElementById('financeiro-modal-delete'),
  };

  const moneyInputs = [
    els.fieldOrcamentoCategoria,
    els.fieldOrcamento,
    els.fieldValorUnit,
    els.fieldValorBonificado,
    els.fieldValorTotal,
    els.fieldPreEvento,
    els.fieldPosEvento,
    els.fieldRealizadoPago,
    els.fieldReembolso,
  ].filter(Boolean);

  let linhas = [];
  let editId = null;
  let loading = false;
  let modeloLoading = false;

  moneyInputs.forEach((input) => {
    input.addEventListener('input', () => maskValorInput(input));
  });

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

  function renderSummary() {
    if (!els.summary) return;
    const n = linhas.length;
    if (!n) {
      els.summary.textContent = 'Nenhuma linha cadastrada. Carregue o modelo da planilha para começar.';
      return;
    }
    els.summary.textContent = `${n} linha${n === 1 ? '' : 's'} no resultado financeiro deste evento.`;
  }

  function renderEmptyState() {
    const empty = !linhas.length;
    els.empty?.classList.toggle('hidden', !empty);
    els.tableWrap?.classList.toggle('hidden', empty);
    els.btnModelo?.classList.toggle('hidden', empty);
  }

  function renderTable() {
    if (!els.table) return;
    if (!linhas.length) {
      els.table.innerHTML = '';
      renderEmptyState();
      renderSummary();
      return;
    }

    els.table.innerHTML = linhas
      .map(
        (l) => `
      <tr class="${rowClass(l.tipo)}" data-id="${l.id}" tabindex="0" role="button" title="Clique para editar">
        <td class="fin-col-item">${cellText(l.item)}</td>
        <td class="fin-col-money">${cellMoney(l.orcamentoCategoria)}</td>
        <td class="fin-col-sub">${cellText(l.subItem)}</td>
        <td>${cellText(l.previstoQtde)}</td>
        <td>${cellText(l.diaria)}</td>
        <td class="fin-col-money">${cellMoney(l.orcamento)}</td>
        <td class="fin-col-money">${cellMoney(l.valorUnit)}</td>
        <td class="fin-col-money">${cellMoney(l.valorBonificado)}</td>
        <td class="fin-col-money">${cellMoney(l.valorTotal)}</td>
        <td class="fin-col-money">${cellMoney(l.preEvento)}</td>
        <td class="fin-col-money">${cellMoney(l.posEvento)}</td>
        <td class="fin-col-money">${cellMoney(l.realizadoPago)}</td>
        <td>${cellText(l.status)}</td>
        <td>${cellText(l.dtPrevista)}</td>
        <td>${cellText(l.dtRealiz)}</td>
        <td>${cellText(l.quem)}</td>
        <td class="fin-col-money">${cellMoney(l.reembolso)}</td>
      </tr>`,
      )
      .join('');

    renderEmptyState();
    renderSummary();
  }

  function fillMoney(el, val) {
    if (!el) return;
    el.value = val != null ? formatValorInput(val) : '';
  }

  function openModal(linha = null) {
    editId = linha?.id ?? null;
    showFormErrors(null);

    if (els.modalTitle) {
      els.modalTitle.textContent = editId ? 'Editar linha' : 'Nova linha';
    }
    if (els.modalSub) {
      els.modalSub.textContent = editId
        ? 'Altere os campos conforme a planilha Resultado.'
        : 'Preencha item ou sub-item e os valores financeiros.';
    }

    if (els.fieldTipo) els.fieldTipo.value = linha?.tipo || 'linha';
    if (els.fieldItem) els.fieldItem.value = linha?.item || '';
    fillMoney(els.fieldOrcamentoCategoria, linha?.orcamentoCategoria);
    if (els.fieldSubItem) els.fieldSubItem.value = linha?.subItem || '';
    if (els.fieldPrevistoQtde) els.fieldPrevistoQtde.value = linha?.previstoQtde || '';
    if (els.fieldDiaria) els.fieldDiaria.value = linha?.diaria || '';
    fillMoney(els.fieldOrcamento, linha?.orcamento);
    fillMoney(els.fieldValorUnit, linha?.valorUnit);
    fillMoney(els.fieldValorBonificado, linha?.valorBonificado);
    fillMoney(els.fieldValorTotal, linha?.valorTotal);
    fillMoney(els.fieldPreEvento, linha?.preEvento);
    fillMoney(els.fieldPosEvento, linha?.posEvento);
    fillMoney(els.fieldRealizadoPago, linha?.realizadoPago);
    if (els.fieldStatus) els.fieldStatus.value = linha?.status || '';
    if (els.fieldDtPrevista) els.fieldDtPrevista.value = linha?.dtPrevista || '';
    if (els.fieldDtRealiz) els.fieldDtRealiz.value = linha?.dtRealiz || '';
    if (els.fieldQuem) els.fieldQuem.value = linha?.quem || '';
    fillMoney(els.fieldReembolso, linha?.reembolso);

    els.btnDelete?.classList.toggle('hidden', !editId);
    els.modalBg?.classList.add('open');
    els.fieldItem?.focus();
  }

  function closeModal() {
    editId = null;
    showFormErrors(null);
    els.modalBg?.classList.remove('open');
  }

  function readForm() {
    return {
      tipo: els.fieldTipo?.value || 'linha',
      item: els.fieldItem?.value?.trim() || '',
      orcamentoCategoria: readMoneyInput(els.fieldOrcamentoCategoria),
      subItem: els.fieldSubItem?.value?.trim() || '',
      previstoQtde: els.fieldPrevistoQtde?.value?.trim() || '',
      diaria: els.fieldDiaria?.value?.trim() || '',
      orcamento: readMoneyInput(els.fieldOrcamento),
      valorUnit: readMoneyInput(els.fieldValorUnit),
      valorBonificado: readMoneyInput(els.fieldValorBonificado),
      valorTotal: readMoneyInput(els.fieldValorTotal),
      preEvento: readMoneyInput(els.fieldPreEvento),
      posEvento: readMoneyInput(els.fieldPosEvento),
      realizadoPago: readMoneyInput(els.fieldRealizadoPago),
      status: els.fieldStatus?.value?.trim() || '',
      dtPrevista: els.fieldDtPrevista?.value?.trim() || '',
      dtRealiz: els.fieldDtRealiz?.value?.trim() || '',
      quem: els.fieldQuem?.value?.trim() || '',
      reembolso: readMoneyInput(els.fieldReembolso),
    };
  }

  async function loadFinanceiroGestao() {
    if (loading) return;
    loading = true;
    try {
      const { linhas: data } = await fetchFinanceiroResultado();
      linhas = data || [];
      renderTable();
    } catch (err) {
      if (els.summary) {
        els.summary.textContent = err.message || 'Falha ao carregar resultado financeiro.';
      }
    } finally {
      loading = false;
    }
  }

  function setModeloButtonsDisabled(disabled) {
    els.btnModelo?.toggleAttribute('disabled', disabled);
    els.btnEmptyModelo?.toggleAttribute('disabled', disabled);
  }

  async function carregarModelo({ substituir = false } = {}) {
    if (modeloLoading) return;
    if (substituir) {
      const ok = window.confirm(
        'Isso apaga todas as linhas deste evento e recarrega o modelo da planilha. Continuar?',
      );
      if (!ok) return;
    }
    modeloLoading = true;
    setModeloButtonsDisabled(true);
    try {
      const { linhas: data } = await carregarModeloFinanceiroResultado({ substituir });
      linhas = data || [];
      renderTable();
    } catch (err) {
      if (err.status === 409) {
        const ok = window.confirm(`${err.message}\n\nDeseja substituir todas as linhas pelo modelo?`);
        if (ok) {
          modeloLoading = false;
          await carregarModelo({ substituir: true });
        }
        return;
      }
      window.alert(err.message || 'Falha ao carregar modelo.');
    } finally {
      modeloLoading = false;
      setModeloButtonsDisabled(false);
    }
  }

  async function saveLinha() {
    const data = readForm();
    if (!data.item && !data.subItem) {
      showFormErrors('Informe o item ou o sub-item.');
      els.fieldItem?.focus();
      return;
    }
    showFormErrors(null);
    els.btnSave.disabled = true;
    try {
      if (editId) {
        const { linha } = await updateFinanceiroLinha(editId, data);
        const idx = linhas.findIndex((l) => l.id === editId);
        if (idx >= 0 && linha) linhas[idx] = linha;
      } else {
        const { linha } = await createFinanceiroLinha(data);
        if (linha) linhas.push(linha);
      }
      renderTable();
      closeModal();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
    }
  }

  async function removeLinha() {
    if (!editId) return;
    const linha = linhas.find((l) => l.id === editId);
    const label = linha?.subItem || linha?.item || 'esta linha';
    const ok = window.confirm(`Excluir "${label}"?`);
    if (!ok) return;
    try {
      await deleteFinanceiroLinha(editId);
      linhas = linhas.filter((l) => l.id !== editId);
      renderTable();
      closeModal();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível excluir.');
    }
  }

  els.btnNew?.addEventListener('click', () => openModal());
  els.btnModelo?.addEventListener('click', () => carregarModelo({ substituir: linhas.length > 0 }));
  els.btnEmptyModelo?.addEventListener('click', () => carregarModelo({ substituir: false }));
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveLinha());
  els.btnDelete?.addEventListener('click', () => void removeLinha());

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.table?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const linha = linhas.find((l) => l.id === id);
    if (linha) openModal(linha);
  });

  els.table?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    const id = Number(tr.dataset.id);
    const linha = linhas.find((l) => l.id === id);
    if (linha) openModal(linha);
  });

  financeiroGestaoInstance = { loadFinanceiroGestao };
  return financeiroGestaoInstance;
}
