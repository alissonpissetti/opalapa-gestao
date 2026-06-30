import {
  fetchProducaoPremiacoes,
  createProducaoPremiacao,
  updateProducaoPremiacao,
  deleteProducaoPremiacao,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { bindWhatsappChatButtons, renderWhatsappPhoneButton } from '../lib/whatsapp-chat.js';

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

function mapServerError(message) {
  const text = String(message || '').trim();
  if (!text) return [{ field: null, message: 'Não foi possível salvar.' }];
  if (/prêmio/i.test(text)) return [{ field: 'nome', message: text }];
  if (/vencedor/i.test(text)) return [{ field: 'vencedorNome', message: text }];
  return [{ field: null, message: text }];
}

function truncate(text, max = 80) {
  const s = String(text || '').trim();
  if (!s) return '—';
  if (s.length <= max) return escapeHtml(s);
  return `${escapeHtml(s.slice(0, max - 1))}…`;
}

export function initProducaoPremiacoesModule({ onOpenWhatsappChat, onSaved } = {}) {
  const els = {
    summary: document.getElementById('premiacoes-summary'),
    table: document.getElementById('premiacoes-table'),
    btnNew: document.getElementById('btn-premiacoes-new'),
    modalBg: document.getElementById('premiacoes-modal-bg'),
    modalTitle: document.getElementById('premiacoes-modal-title'),
    modalSub: document.getElementById('premiacoes-modal-sub'),
    formErrors: document.getElementById('premiacoes-modal-errors'),
    fieldNome: document.getElementById('premiacoes-modal-nome'),
    fieldDescricao: document.getElementById('premiacoes-modal-descricao'),
    fieldVencedorNome: document.getElementById('premiacoes-modal-vencedor-nome'),
    fieldVencedorTelefone: document.getElementById('premiacoes-modal-vencedor-telefone'),
    btnCancel: document.getElementById('premiacoes-modal-cancel'),
    btnSave: document.getElementById('premiacoes-modal-save'),
    btnDelete: document.getElementById('premiacoes-modal-delete'),
  };

  const fieldInputs = {
    nome: els.fieldNome,
    vencedorNome: els.fieldVencedorNome,
  };

  let items = [];
  let editId = null;

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
    if (!payload.nome) errors.push({ field: 'nome', message: 'Informe o nome do prêmio.' });
    if (payload.vencedorTelefone && !payload.vencedorNome) {
      errors.push({
        field: 'vencedorNome',
        message: 'Informe o nome do vencedor ao cadastrar o telefone.',
      });
    }
    return errors;
  }

  function renderTable() {
    if (!items.length) {
      els.table.innerHTML =
        '<tr class="premiacoes-empty-row"><td colspan="5" class="cell-empty">Nenhum prêmio cadastrado.</td></tr>';
      els.summary.textContent = '0 prêmio(s)';
      return;
    }

    els.table.innerHTML = items
      .map((item) => {
        const hasVencedor = Boolean(item.vencedorNome);
        const hasTelefone = Boolean(item.vencedorTelefone);
        return `
          <tr data-id="${item.id}" class="premiacoes-card-row">
            <td class="premiacoes-cell-nome"><strong>${escapeHtml(item.nome)}</strong></td>
            <td class="premiacoes-cell-descricao">${truncate(item.descricao, 100)}</td>
            <td class="premiacoes-cell-vencedor${hasVencedor ? '' : ' cell-empty'}">${hasVencedor ? escapeHtml(item.vencedorNome) : '—'}</td>
            <td class="premiacoes-cell-telefone${hasTelefone ? '' : ' cell-empty'}">${
              hasTelefone
                ? renderWhatsappPhoneButton({
                    participanteId: item.participanteId,
                    phone: item.vencedorTelefone,
                  })
                : '—'
            }</td>
            <td class="premiacoes-cell-acoes row-actions row-actions--premiacoes">
              <button class="tbtn" type="button" data-action="edit" data-id="${item.id}">Editar</button>
              <button class="tbtn danger-text" type="button" data-action="delete" data-id="${item.id}">Excluir</button>
            </td>
          </tr>`;
      })
      .join('');

    els.summary.textContent = `${items.length} prêmio(s) neste evento`;

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
        if (!confirm(`Excluir o prêmio "${item.nome}"?`)) return;
        try {
          await deleteProducaoPremiacao(item.id);
          await loadPremiacoes();
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
    els.modalTitle.textContent = isEdit ? 'Editar prêmio' : 'Novo prêmio';
    els.modalSub.textContent = isEdit
      ? `Alterando ${item.nome}`
      : 'Cadastre um prêmio deste evento e, se já houver, o vencedor.';
    els.fieldNome.value = item?.nome || '';
    els.fieldDescricao.value = item?.descricao || '';
    els.fieldVencedorNome.value = item?.vencedorNome || '';
    els.fieldVencedorTelefone.value = item?.vencedorTelefone
      ? formatPhone(item.vencedorTelefone)
      : '';
    els.btnDelete.classList.toggle('hidden', !isEdit);

    els.modalBg.classList.add('open');
    els.fieldNome.focus();
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    editId = null;
    clearFormErrors();
  }

  function readForm() {
    return {
      nome: els.fieldNome.value.trim(),
      descricao: els.fieldDescricao.value.trim(),
      vencedorNome: els.fieldVencedorNome.value.trim(),
      vencedorTelefone: els.fieldVencedorTelefone.value.replace(/\D/g, ''),
    };
  }

  async function loadPremiacoes() {
    const data = await fetchProducaoPremiacoes();
    items = data.items || [];
    renderTable();
  }

  els.fieldVencedorTelefone?.addEventListener('input', () => maskPhoneInput(els.fieldVencedorTelefone));

  Object.values(fieldInputs).forEach((input) => {
    input?.addEventListener('input', () => touchValidatedField(input));
  });

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
        await updateProducaoPremiacao(editId, payload);
      } else {
        await createProducaoPremiacao(payload);
      }
      closeModal();
      await loadPremiacoes();
      onSaved?.();
    } catch (err) {
      showFormErrors(mapServerError(err.message), { focus: true });
    }
  });

  els.btnDelete?.addEventListener('click', async () => {
    if (!editId) return;
    const item = items.find((i) => i.id === editId);
    if (!item) return;
    if (!confirm(`Excluir o prêmio "${item.nome}"?`)) return;
    try {
      await deleteProducaoPremiacao(editId);
      closeModal();
      await loadPremiacoes();
    } catch (err) {
      alert(err.message);
    }
  });

  return { loadPremiacoes };
}
