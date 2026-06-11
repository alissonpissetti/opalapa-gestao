import {
  fetchArrecadacao,
  createPatrocinio,
  updateArrecadacao,
  deleteArrecadacao,
} from '../lib/api.js';
import {
  fmtMoney,
  escapeHtml,
  parseValor,
  formatValorInput,
  maskValorInput,
} from '../lib/format.js';

const TIPO_LABELS = {
  espaco: 'Espaço',
  patrocinio: 'Patrocínio',
};

export function initArrecadacaoModule(store) {
  const els = {
    summary: document.getElementById('arrecadacao-summary'),
    stats: document.getElementById('arrecadacao-stats'),
    table: document.getElementById('arrecadacao-table'),
    btnNew: document.getElementById('btn-patrocinio-new'),
    modalBg: document.getElementById('arrecadacao-modal-bg'),
    modalTitle: document.getElementById('arrecadacao-modal-title'),
    modalSub: document.getElementById('arrecadacao-modal-sub'),
    participante: document.getElementById('a-participante'),
    participanteId: document.getElementById('a-participante-id'),
    descricao: document.getElementById('a-descricao'),
    descricaoField: document.getElementById('a-descricao-field'),
    valorTotal: document.getElementById('a-valor-total'),
    valorPago: document.getElementById('a-valor-pago'),
    valorTotalHint: document.getElementById('a-valor-total-hint'),
    obs: document.getElementById('a-obs'),
    btnCancel: document.getElementById('arrecadacao-btn-cancel'),
    btnSave: document.getElementById('arrecadacao-btn-save'),
    btnDelete: document.getElementById('arrecadacao-btn-delete'),
  };

  let items = [];
  let participantes = [];
  let editId = null;
  let editTipo = null;
  let isCreateMode = false;

  function renderParticipantesDatalist() {
    const datalist = document.getElementById('arrecadacao-participantes-list');
    if (!datalist) return;
    const list = [...participantes].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    );
    datalist.innerHTML = list
      .map((p) => `<option value="${escapeHtml(p.nome)}"></option>`)
      .join('');
  }

  function matchParticipanteByNome(nome) {
    const q = String(nome || '').trim().toLowerCase();
    if (!q) return null;
    return participantes.find((p) => p.nome.toLowerCase() === q) || null;
  }

  function readParticipanteInput() {
    const nome = els.participante.value.trim();
    if (!nome) return { participanteId: null, participanteNome: '' };
    const matched = matchParticipanteByNome(nome);
    if (matched) return { participanteId: matched.id, participanteNome: matched.nome };
    const id = els.participanteId.value ? Number(els.participanteId.value) : null;
    if (id) {
      const byId = participantes.find((p) => p.id === id);
      if (byId && byId.nome.toLowerCase() === nome.toLowerCase()) {
        return { participanteId: byId.id, participanteNome: byId.nome };
      }
    }
    return { participanteId: null, participanteNome: nome };
  }

  function syncParticipanteIdFromInput() {
    const matched = matchParticipanteByNome(els.participante.value);
    els.participanteId.value = matched ? String(matched.id) : '';
  }

  function openModal(item = null, mode = 'edit') {
    isCreateMode = mode === 'create' && !item;
    editId = isCreateMode ? null : (item?.id ?? null);
    editTipo = item?.tipo ?? (isCreateMode ? 'patrocinio' : null);
    const isCreate = isCreateMode;
    const isEspaco = editTipo === 'espaco';

    els.modalTitle.textContent = isCreate
      ? 'Novo patrocinador'
      : isEspaco
        ? 'Arrecadação — espaço'
        : 'Arrecadação — patrocínio';
    els.modalSub.textContent = isCreate
      ? 'Cadastre um patrocinador e o valor acordado.'
      : item
        ? `${TIPO_LABELS[item.tipo]} · ${item.participanteNome}`
        : '';

    els.participante.value = item?.participanteNome || '';
    els.participanteId.value = item?.participanteId ? String(item.participanteId) : '';
    els.participante.disabled = isEspaco;
    els.descricao.value = item?.descricao || (isCreate ? 'Patrocínio' : '');
    els.descricaoField.classList.toggle('hidden', isEspaco);
    els.valorTotal.value = formatValorInput(item?.valorTotal ?? 0);
    els.valorPago.value = formatValorInput(item?.valorPago ?? 0);
    els.valorTotal.disabled = isEspaco;
    els.valorTotalHint.textContent = isEspaco
      ? 'Valor total sincronizado automaticamente a partir do espaço.'
      : '';
    els.obs.value = item?.obs || '';

    els.btnDelete.classList.toggle('hidden', isCreate || isEspaco);
    els.modalBg.classList.add('open');
    (isEspaco ? els.valorPago : els.participante).focus();
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    els.participante.disabled = false;
    els.valorTotal.disabled = false;
    editId = null;
    editTipo = null;
    isCreateMode = false;
  }

  function readForm() {
    const participante = readParticipanteInput();
    return {
      ...participante,
      descricao: els.descricao.value.trim() || 'Patrocínio',
      valorTotal: parseValor(els.valorTotal.value) ?? 0,
      valorPago: parseValor(els.valorPago.value) ?? 0,
      obs: els.obs.value.trim(),
    };
  }

  function renderStats(resumo) {
    if (!els.stats) return;
    els.stats.innerHTML = `
      <div class="stat">
        <div class="lbl">Total acordado</div>
        <div class="val">${fmtMoney(resumo.total)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Já pago</div>
        <div class="val" style="color:#5dcaa5">${fmtMoney(resumo.pago)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Falta pagar</div>
        <div class="val" style="color:#fac775">${fmtMoney(resumo.falta)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Registros</div>
        <div class="val">${resumo.count}</div>
      </div>
    `;
  }

  async function loadArrecadacao() {
    const data = await fetchArrecadacao();
    items = data.items || [];
    participantes = data.participantes || [];
    store?.setParticipantes(participantes);
    renderParticipantesDatalist();
    renderStats(data.resumo || { total: 0, pago: 0, falta: 0, count: 0 });
    renderTable();
    return items;
  }

  function renderTable() {
    if (!items.length) {
      els.table.innerHTML =
        '<tr><td colspan="8" class="cell-empty">Nenhum registro de arrecadação.</td></tr>';
      els.summary.textContent =
        'Vincule participantes aos espaços ou cadastre patrocinadores para acompanhar os pagamentos.';
      return;
    }

    els.table.innerHTML = items
      .map((item) => {
        const quitado = item.valorFalta <= 0 && item.valorTotal > 0;
        return `
        <tr data-id="${item.id}">
          <td><strong>${escapeHtml(item.participanteNome)}</strong></td>
          <td><span class="badge ${item.tipo === 'espaco' ? 'neg' : 'res'}">${TIPO_LABELS[item.tipo]}</span></td>
          <td class="${item.descricao ? '' : 'cell-empty'}">${item.descricao ? escapeHtml(item.descricao) : '—'}</td>
          <td class="cell-money">${fmtMoney(item.valorTotal)}</td>
          <td class="cell-money" style="color:#5dcaa5">${fmtMoney(item.valorPago)}</td>
          <td class="cell-money ${item.valorFalta > 0 ? '' : 'cell-empty'}">${item.valorFalta > 0 ? fmtMoney(item.valorFalta) : quitado ? 'Quitado' : '—'}</td>
          <td class="${item.obs ? 'cell-muted' : 'cell-empty'}">${item.obs ? escapeHtml(item.obs) : '—'}</td>
          <td class="row-actions">
            <button class="tbtn" type="button" data-action="edit" data-id="${item.id}">Editar</button>
            ${item.tipo === 'patrocinio' ? `<button class="tbtn danger-text" type="button" data-action="delete" data-id="${item.id}">Excluir</button>` : ''}
          </td>
        </tr>
      `;
      })
      .join('');

    els.summary.textContent = `${items.length} registro(s) de arrecadação`;

    els.table.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) openModal(item);
      });
    });

    els.table.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (!item || !confirm(`Excluir o patrocínio de "${item.participanteNome}"?`)) return;
        try {
          await deleteArrecadacao(item.id);
          await loadArrecadacao();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const item = items.find((x) => x.id === Number(row.dataset.id));
        if (item) openModal(item);
      });
    });
  }

  async function saveItem() {
    const form = readForm();
    if (!form.participanteNome && !form.participanteId) {
      alert('Informe o participante ou patrocinador.');
      return;
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      if (isCreateMode || !editId) {
        await createPatrocinio(form);
      } else {
        await updateArrecadacao(editId, form);
      }
      closeModal();
      await loadArrecadacao();
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  async function removeItem() {
    if (!editId) return;
    const item = items.find((x) => x.id === editId);
    if (!item || !confirm(`Excluir o patrocínio de "${item.participanteNome}"?`)) return;

    els.btnDelete.disabled = true;
    try {
      await deleteArrecadacao(editId);
      closeModal();
      await loadArrecadacao();
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnDelete.disabled = false;
    }
  }

  els.btnNew.addEventListener('click', () => openModal(null, 'create'));
  els.btnCancel.addEventListener('click', closeModal);
  els.btnSave.addEventListener('click', saveItem);
  els.btnDelete.addEventListener('click', removeItem);
  els.participante.addEventListener('input', syncParticipanteIdFromInput);
  els.participante.addEventListener('change', syncParticipanteIdFromInput);
  els.valorTotal.addEventListener('input', (e) => maskValorInput(e.target));
  els.valorPago.addEventListener('input', (e) => maskValorInput(e.target));

  els.modalBg.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modalBg.classList.contains('open')) closeModal();
  });

  return { loadArrecadacao };
}
