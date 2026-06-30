import {
  fetchProducaoCronologia,
  createProducaoCronologia,
  updateProducaoCronologia,
  deleteProducaoCronologia,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { bindWhatsappChatButtons, renderWhatsappPhoneButton } from '../lib/whatsapp-chat.js';

const ANO_MIN = 1968;
const ANO_MAX = 1992;

const SITUACAO_LABELS = {
  confirmado: 'Confirmado',
  negociacao: 'Negociação',
  desejado: 'Desejado',
};

const SITUACAO_BADGE = {
  confirmado: 'disp',
  negociacao: 'res',
  desejado: 'neg',
};

function formatPhone(phone) {
  if (!phone) return '—';
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function maskPhoneInput(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 11);
  if (!digits) {
    el.value = '';
    return;
  }
  if (digits.length <= 2) {
    el.value = `(${digits}`;
    return;
  }
  if (digits.length <= 6) {
    el.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return;
  }
  if (digits.length <= 10) {
    el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return;
  }
  el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function buildAnoOptions(selected = '') {
  const opts = ['<option value="">Todos</option>'];
  for (let y = ANO_MIN; y <= ANO_MAX; y += 1) {
    opts.push(
      `<option value="${y}"${String(y) === String(selected) ? ' selected' : ''}>${y}</option>`,
    );
  }
  return opts.join('');
}

function buildAnoFormOptions(selected = '') {
  const opts = ['<option value="">Selecione</option>'];
  for (let y = ANO_MIN; y <= ANO_MAX; y += 1) {
    opts.push(
      `<option value="${y}"${String(y) === String(selected) ? ' selected' : ''}>${y}</option>`,
    );
  }
  return opts.join('');
}

function mapServerError(message) {
  const text = String(message || '').trim();
  if (!text) return [{ field: null, message: 'Não foi possível salvar.' }];
  if (/veículo/i.test(text)) return [{ field: 'veiculo', message: text }];
  if (/nome/i.test(text)) return [{ field: 'nome', message: text }];
  if (/ano/i.test(text)) return [{ field: 'ano', message: text }];
  return [{ field: null, message: text }];
}

export function initProducaoCronologiaModule({ onOpenWhatsappChat, onSaved } = {}) {
  const els = {
    summary: document.getElementById('cronologia-summary'),
    table: document.getElementById('cronologia-table'),
    filterAno: document.getElementById('cronologia-filter-ano'),
    filterSituacao: document.getElementById('cronologia-filter-situacao'),
    btnNew: document.getElementById('btn-cronologia-new'),
    modalBg: document.getElementById('cronologia-modal-bg'),
    modalTitle: document.getElementById('cronologia-modal-title'),
    modalSub: document.getElementById('cronologia-modal-sub'),
    formErrors: document.getElementById('cronologia-modal-errors'),
    fieldVeiculo: document.getElementById('cronologia-modal-veiculo'),
    veiculosDatalist: document.getElementById('cronologia-veiculos-list'),
    fieldNome: document.getElementById('cronologia-modal-nome'),
    fieldTelefone: document.getElementById('cronologia-modal-telefone'),
    fieldAno: document.getElementById('cronologia-modal-ano'),
    fieldCidadeUf: document.getElementById('cronologia-modal-cidade-uf'),
    fieldSituacao: document.getElementById('cronologia-modal-situacao'),
    btnCancel: document.getElementById('cronologia-modal-cancel'),
    btnSave: document.getElementById('cronologia-modal-save'),
    btnDelete: document.getElementById('cronologia-modal-delete'),
  };

  const fieldInputs = {
    veiculo: els.fieldVeiculo,
    nome: els.fieldNome,
    ano: els.fieldAno,
  };

  let items = [];
  let veiculos = [];
  let editId = null;

  if (els.filterAno) els.filterAno.innerHTML = buildAnoOptions();
  if (els.fieldAno) els.fieldAno.innerHTML = buildAnoFormOptions();

  function fieldWrap(input) {
    return input?.closest('.field') || null;
  }

  function clearFormErrors() {
    els.formErrors?.classList.add('hidden');
    if (els.formErrors) els.formErrors.textContent = '';
    Object.values(fieldInputs).forEach((input) => {
      fieldWrap(input)?.classList.remove('is-invalid');
    });
  }

  function showFormErrors(errors, { focus = false } = {}) {
    const list = Array.isArray(errors) ? errors : [errors];
    clearFormErrors();

    const messages = list.map((err) => err.message).filter(Boolean);
    if (els.formErrors && messages.length) {
      els.formErrors.textContent = messages.join(' ');
      els.formErrors.classList.remove('hidden');
    }

    let firstInvalid = null;
    for (const err of list) {
      const input = err.field ? fieldInputs[err.field] : null;
      if (!input) continue;
      fieldWrap(input)?.classList.add('is-invalid');
      if (!firstInvalid) firstInvalid = input;
    }
    if (focus) firstInvalid?.focus();
  }

  function touchValidatedField(input) {
    fieldWrap(input)?.classList.remove('is-invalid');
    const stillInvalid = Object.values(fieldInputs).some((el) =>
      fieldWrap(el)?.classList.contains('is-invalid'),
    );
    if (!stillInvalid) clearFormErrors();
  }

  function validateForm(payload) {
    const errors = [];
    if (!payload.veiculo) errors.push({ field: 'veiculo', message: 'Informe o veículo.' });
    if (!payload.nome) errors.push({ field: 'nome', message: 'Informe o nome.' });
    if (!payload.ano) errors.push({ field: 'ano', message: 'Selecione o ano.' });
    return errors;
  }

  function renderVeiculosDatalist() {
    if (!els.veiculosDatalist) return;
    els.veiculosDatalist.innerHTML = veiculos
      .map((nome) => `<option value="${escapeHtml(nome)}">`)
      .join('');
  }

  function getFilteredItems() {
    const ano = els.filterAno?.value || '';
    const situacao = els.filterSituacao?.value || '';
    return items.filter((item) => {
      if (ano && String(item.ano) !== ano) return false;
      if (situacao && item.situacao !== situacao) return false;
      return true;
    });
  }

  function renderTable() {
    const filtered = getFilteredItems();
    if (!filtered.length) {
      els.table.innerHTML =
        '<tr class="cronologia-empty-row"><td colspan="7" class="cell-empty">Nenhum registro na cronologia.</td></tr>';
      els.summary.textContent = items.length
        ? `0 de ${items.length} registro(s) com os filtros atuais`
        : '0 registro(s)';
      return;
    }

    els.table.innerHTML = filtered
      .map((item) => {
        const badge = SITUACAO_BADGE[item.situacao] || 'neg';
        const label = SITUACAO_LABELS[item.situacao] || item.situacao;
        const hasTelefone = Boolean(item.telefone);
        const hasCidade = Boolean(item.cidadeUf);
        return `
          <tr data-id="${item.id}" class="cronologia-card-row">
            <td class="cronologia-cell-ano"><strong>${item.ano}</strong></td>
            <td class="cronologia-cell-veiculo">${escapeHtml(item.veiculo || '—')}</td>
            <td class="cronologia-cell-nome"><strong>${escapeHtml(item.nome)}</strong></td>
            <td class="cronologia-cell-telefone${hasTelefone ? '' : ' cronologia-cell-telefone--empty'}">${
              hasTelefone
                ? renderWhatsappPhoneButton({
                    participanteId: item.participanteId,
                    phone: item.telefone,
                  })
                : '—'
            }</td>
            <td class="cronologia-cell-cidade${hasCidade ? '' : ' cronologia-cell-cidade--empty'}">${hasCidade ? escapeHtml(item.cidadeUf) : '—'}</td>
            <td class="cronologia-cell-situacao"><span class="badge ${badge}">${escapeHtml(label)}</span></td>
            <td class="cronologia-cell-acoes row-actions row-actions--cronologia">
              <button class="tbtn" type="button" data-action="edit" data-id="${item.id}">Editar</button>
              <button class="tbtn danger-text" type="button" data-action="delete" data-id="${item.id}">Excluir</button>
            </td>
          </tr>
        `;
      })
      .join('');

    const summaryParts = [`${filtered.length} registro(s)`];
    if (filtered.length !== items.length) {
      summaryParts.push(`de ${items.length} no total`);
    }
    els.summary.textContent = summaryParts.join(' ');

    bindWhatsappChatButtons(els.table, onOpenWhatsappChat);

    els.table.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((i) => i.id === Number(btn.dataset.id));
        if (item) openModal(item);
      });
    });

    els.table.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = items.find((i) => i.id === Number(btn.dataset.id));
        if (!item) return;
        if (!confirm(`Excluir "${item.nome}" (${item.ano})?`)) return;
        try {
          await deleteProducaoCronologia(item.id);
          await loadCronologia();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="open-whatsapp-chat"]')) return;
        const item = items.find((i) => i.id === Number(row.dataset.id));
        if (item) openModal(item);
      });
    });
  }

  function openModal(item = null) {
    editId = item?.id ?? null;
    const isEdit = editId != null;

    clearFormErrors();
    els.modalTitle.textContent = isEdit ? 'Editar registro' : 'Novo registro';
    els.modalSub.textContent = isEdit
      ? `Alterando ${item.nome} (${item.ano})`
      : 'Cadastre uma pessoa ou atração na cronologia histórica do Opalapa.';
    els.fieldVeiculo.value = item?.veiculo || '';
    els.fieldNome.value = item?.nome || '';
    els.fieldTelefone.value = item?.telefone ? formatPhone(item.telefone) : '';
    els.fieldAno.innerHTML = buildAnoFormOptions(item?.ano || '');
    els.fieldCidadeUf.value = item?.cidadeUf || '';
    els.fieldSituacao.value = item?.situacao || 'desejado';
    els.btnDelete.classList.toggle('hidden', !isEdit);

    els.modalBg.classList.add('open');
    els.fieldVeiculo.focus();
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    editId = null;
    clearFormErrors();
  }

  function readForm() {
    return {
      veiculo: els.fieldVeiculo.value.trim(),
      nome: els.fieldNome.value.trim(),
      telefone: els.fieldTelefone.value.replace(/\D/g, ''),
      ano: Number(els.fieldAno.value),
      cidadeUf: els.fieldCidadeUf.value.trim(),
      situacao: els.fieldSituacao.value,
    };
  }

  async function loadCronologia() {
    const data = await fetchProducaoCronologia();
    items = data.items || [];
    veiculos = data.veiculos || [];
    renderVeiculosDatalist();
    renderTable();
  }

  els.fieldTelefone?.addEventListener('input', () => maskPhoneInput(els.fieldTelefone));

  Object.values(fieldInputs).forEach((input) => {
    const eventName = input?.tagName === 'SELECT' ? 'change' : 'input';
    input?.addEventListener(eventName, () => touchValidatedField(input));
  });

  els.filterAno?.addEventListener('change', renderTable);
  els.filterSituacao?.addEventListener('change', renderTable);

  els.btnNew?.addEventListener('click', () => openModal());
  els.btnCancel?.addEventListener('click', closeModal);
  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.btnSave?.addEventListener('click', async () => {
    const payload = readForm();
    const errors = validateForm(payload);
    if (errors.length) {
      showFormErrors(errors, { focus: true });
      return;
    }
    clearFormErrors();
    try {
      if (editId) {
        await updateProducaoCronologia(editId, payload);
      } else {
        await createProducaoCronologia(payload);
      }
      closeModal();
      await loadCronologia();
      onSaved?.();
    } catch (err) {
      showFormErrors(mapServerError(err.message), { focus: true });
    }
  });

  els.btnDelete?.addEventListener('click', async () => {
    if (!editId) return;
    const item = items.find((i) => i.id === editId);
    if (!item) return;
    if (!confirm(`Excluir "${item.nome}" (${item.ano})?`)) return;
    try {
      await deleteProducaoCronologia(editId);
      closeModal();
      await loadCronologia();
    } catch (err) {
      alert(err.message);
    }
  });

  return { loadCronologia };
}
