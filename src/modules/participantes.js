import {
  fetchParticipantes,
  createParticipante,
  updateParticipante,
  deleteParticipante,
} from '../lib/api.js';
import { fmtDate, escapeHtml } from '../lib/format.js';

function formatPhone(phone) {
  if (!phone) return '—';
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function formatSeguidores(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('pt-BR');
}

function formatInstagram(ig) {
  if (!ig) return '—';
  return ig.startsWith('@') ? ig : `@${ig}`;
}

export function initParticipantesModule(store) {
  const els = {
    table: document.getElementById('participantes-table'),
    summary: document.getElementById('participantes-summary'),
    selectBar: document.getElementById('participantes-select-bar'),
    selCount: document.getElementById('participantes-sel-count'),
    selNames: document.getElementById('participantes-sel-names'),
    chkAll: document.getElementById('participantes-chk-all'),
    btnDeleteSelected: document.getElementById('btn-participantes-delete-selected'),
    btnClearSelection: document.getElementById('btn-participantes-clear-selection'),
    btnNew: document.getElementById('btn-participante-new'),
    modalBg: document.getElementById('participante-modal-bg'),
    modalTitle: document.getElementById('participante-modal-title'),
    modalSub: document.getElementById('participante-modal-sub'),
    nome: document.getElementById('p-nome'),
    instagram: document.getElementById('p-instagram'),
    seguidores: document.getElementById('p-seguidores'),
    contatoNome: document.getElementById('p-contato-nome'),
    contatoTelefone: document.getElementById('p-contato-telefone'),
    btnCancel: document.getElementById('participante-btn-cancel'),
    btnSave: document.getElementById('participante-btn-save'),
    btnDelete: document.getElementById('participante-btn-delete'),
  };

  let participantes = [];
  let editId = null;
  const selectedIds = new Set();

  function updateSelectionUi() {
    const selected = participantes.filter((p) => selectedIds.has(p.id));
    els.selectBar?.classList.toggle('visible', selected.length > 0);
    if (els.selCount) els.selCount.textContent = selected.length;
    if (els.selNames) {
      els.selNames.textContent = selected.map((p) => p.nome).join(', ');
    }
    if (els.btnDeleteSelected) {
      els.btnDeleteSelected.disabled = selected.length === 0;
      els.btnDeleteSelected.textContent =
        selected.length > 1
          ? `Excluir selecionados (${selected.length})`
          : 'Excluir selecionados';
    }

    els.table?.querySelectorAll('tr[data-id]').forEach((row) => {
      const id = Number(row.dataset.id);
      row.classList.toggle('selected-row', selectedIds.has(id));
      const chk = row.querySelector('.row-chk');
      if (chk) chk.checked = selectedIds.has(id);
    });

    const visible = [...(els.table?.querySelectorAll('tr[data-id]') || [])];
    const checked = visible.filter((row) => selectedIds.has(Number(row.dataset.id)));
    if (els.chkAll) {
      els.chkAll.checked = visible.length > 0 && checked.length === visible.length;
      els.chkAll.indeterminate = checked.length > 0 && checked.length < visible.length;
    }
  }

  function toggleSelect(id, force) {
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
    participantes.forEach((p) => {
      if (checked) selectedIds.add(p.id);
      else selectedIds.delete(p.id);
    });
    updateSelectionUi();
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

  function maskSeguidoresInput(el) {
    el.value = el.value.replace(/\D/g, '');
  }

  function openModal(participante = null) {
    editId = participante?.id ?? null;
    const isEdit = editId != null;

    els.modalTitle.textContent = isEdit ? 'Editar participante' : 'Novo participante';
    els.modalSub.textContent = isEdit
      ? `Atualizando ${participante.nome}`
      : 'Cadastre os dados do participante do evento.';
    els.nome.value = participante?.nome || '';
    els.instagram.value = participante?.instagram || '';
    els.seguidores.value =
      participante?.seguidores != null ? String(participante.seguidores) : '';
    els.contatoNome.value = participante?.contatoNome || '';
    els.contatoTelefone.value = participante?.contatoTelefone
      ? formatPhone(participante.contatoTelefone)
      : '';

    els.btnDelete.classList.toggle('hidden', !isEdit);
    els.modalBg.classList.add('open');
    els.nome.focus();
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    editId = null;
  }

  function readForm() {
    const seguidoresRaw = els.seguidores.value.trim();
    return {
      nome: els.nome.value.trim(),
      instagram: els.instagram.value.trim(),
      seguidores: seguidoresRaw ? Number(seguidoresRaw) : null,
      contatoNome: els.contatoNome.value.trim(),
      contatoTelefone: els.contatoTelefone.value.replace(/\D/g, ''),
    };
  }

  async function loadParticipantes() {
    const data = await fetchParticipantes();
    participantes = data.participantes || [];
    store?.setParticipantes(participantes);
    renderTable();
    return participantes;
  }

  function renderTable() {
    const validIds = new Set(participantes.map((p) => p.id));
    for (const id of selectedIds) {
      if (!validIds.has(id)) selectedIds.delete(id);
    }

    if (!participantes.length) {
      els.table.innerHTML =
        '<tr><td colspan="8" class="cell-empty">Nenhum participante cadastrado.</td></tr>';
      els.summary.textContent = '0 participante(s)';
      clearSelection();
      return;
    }

    els.table.innerHTML = participantes
      .map(
        (p) => `
        <tr data-id="${p.id}" class="${selectedIds.has(p.id) ? 'selected-row' : ''}">
          <td class="chk-cell">
            <input class="chk row-chk" type="checkbox" ${selectedIds.has(p.id) ? 'checked' : ''} data-id="${p.id}">
          </td>
          <td><strong>${escapeHtml(p.nome)}</strong></td>
          <td class="${p.instagram ? '' : 'cell-empty'}">${p.instagram ? escapeHtml(formatInstagram(p.instagram)) : '—'}</td>
          <td class="${p.seguidores != null ? '' : 'cell-empty'}">${formatSeguidores(p.seguidores)}</td>
          <td class="${p.contatoNome ? '' : 'cell-empty'}">${p.contatoNome ? escapeHtml(p.contatoNome) : '—'}</td>
          <td class="${p.contatoTelefone ? '' : 'cell-empty'}">${p.contatoTelefone ? formatPhone(p.contatoTelefone) : '—'}</td>
          <td class="cell-muted">${fmtDate(p.updatedAt || p.createdAt)}</td>
          <td class="row-actions">
            <button class="tbtn" type="button" data-action="edit" data-id="${p.id}">Editar</button>
            <button class="tbtn danger-text" type="button" data-action="delete" data-id="${p.id}">Excluir</button>
          </td>
        </tr>
      `,
      )
      .join('');

    els.summary.textContent = `${participantes.length} participante(s) cadastrado(s)`;

    els.table.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = participantes.find((x) => x.id === Number(btn.dataset.id));
        if (p) openModal(p);
      });
    });

    els.table.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = participantes.find((x) => x.id === Number(btn.dataset.id));
        if (!p || !confirm(`Excluir o participante "${p.nome}"?`)) return;
        try {
          await deleteParticipante(p.id);
          selectedIds.delete(p.id);
          await loadParticipantes();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const p = participantes.find((x) => x.id === Number(row.dataset.id));
        if (p) openModal(p);
      });
      const chk = row.querySelector('.row-chk');
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => toggleSelect(Number(chk.dataset.id), chk.checked));
    });

    updateSelectionUi();
  }

  async function saveParticipante() {
    const form = readForm();
    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      if (editId) {
        await updateParticipante(editId, form);
      } else {
        await createParticipante(form);
      }
      closeModal();
      try {
        await loadParticipantes();
      } catch (err) {
        alert(`Dados salvos, mas falhou ao atualizar a lista: ${err.message}`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  async function removeParticipante() {
    if (!editId) return;
    const p = participantes.find((x) => x.id === editId);
    if (!p || !confirm(`Excluir o participante "${p.nome}"?`)) return;

    els.btnDelete.disabled = true;
    try {
      await deleteParticipante(editId);
      selectedIds.delete(editId);
      closeModal();
      await loadParticipantes();
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnDelete.disabled = false;
    }
  }

  async function removeSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;

    const selected = participantes.filter((p) => selectedIds.has(p.id));
    const msg =
      selected.length === 1
        ? `Excluir o participante "${selected[0].nome}"?`
        : `Excluir ${selected.length} participantes selecionados?`;
    if (!confirm(msg)) return;

    els.btnDeleteSelected.disabled = true;
    els.btnDeleteSelected.textContent = 'Excluindo…';

    const failed = [];
    try {
      for (const id of ids) {
        try {
          await deleteParticipante(id);
          selectedIds.delete(id);
        } catch (err) {
          const p = participantes.find((x) => x.id === id);
          failed.push({ nome: p?.nome || `#${id}`, message: err.message });
        }
      }
      await loadParticipantes();
      if (failed.length) {
        alert(
          `Não foi possível excluir ${failed.length} participante(s):\n\n` +
            failed.map((f) => `• ${f.nome}: ${f.message}`).join('\n'),
        );
      }
    } finally {
      els.btnDeleteSelected.disabled = selectedIds.size === 0;
      els.btnDeleteSelected.textContent = 'Excluir selecionados';
      updateSelectionUi();
    }
  }

  els.btnNew.addEventListener('click', () => openModal());
  els.chkAll?.addEventListener('change', (e) => toggleSelectAll(e.target.checked));
  els.btnClearSelection?.addEventListener('click', clearSelection);
  els.btnDeleteSelected?.addEventListener('click', removeSelected);
  els.btnCancel.addEventListener('click', closeModal);
  els.btnSave.addEventListener('click', saveParticipante);
  els.btnDelete.addEventListener('click', removeParticipante);
  els.contatoTelefone.addEventListener('input', (e) => maskPhoneInput(e.target));
  els.seguidores.addEventListener('input', (e) => maskSeguidoresInput(e.target));

  els.modalBg.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modalBg.classList.contains('open')) closeModal();
  });

  return { loadParticipantes, getParticipantes: () => participantes };
}
