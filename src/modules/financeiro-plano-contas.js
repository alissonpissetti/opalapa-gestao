import {
  fetchFinanceiroCategorias,
  fetchFinanceiroPlanoContas,
  createFinanceiroCategoria,
  updateFinanceiroCategoria,
  deleteFinanceiroCategoria,
  createFinanceiroPlanoConta,
  updateFinanceiroPlanoConta,
  deleteFinanceiroPlanoConta,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';

function statusBadge(ativo) {
  return ativo
    ? '<span class="fin-catalog-badge fin-catalog-badge--ativo">Ativo</span>'
    : '<span class="fin-catalog-badge fin-catalog-badge--inativo">Inativo</span>';
}

let planoContasModuleInstance = null;

export function initFinanceiroPlanoContasModule() {
  if (planoContasModuleInstance) return planoContasModuleInstance;

  const els = {
    summary: document.getElementById('fin-plano-summary'),
    tabs: document.getElementById('fin-plano-tabs'),
    panelCategorias: document.getElementById('fin-plano-panel-categorias'),
    panelPlanos: document.getElementById('fin-plano-panel-planos'),
    tableCategorias: document.getElementById('fin-plano-table-categorias'),
    tablePlanos: document.getElementById('fin-plano-table-planos'),
    btnNewCategoria: document.getElementById('btn-fin-plano-categoria-new'),
    btnNewPlano: document.getElementById('btn-fin-plano-conta-new'),
    modalBg: document.getElementById('fin-plano-modal-bg'),
    modalTitle: document.getElementById('fin-plano-modal-title'),
    formErrors: document.getElementById('fin-plano-modal-errors'),
    fieldNome: document.getElementById('fin-plano-modal-nome'),
    fieldCodigo: document.getElementById('fin-plano-modal-codigo'),
    fieldCodigoWrap: document.getElementById('fin-plano-modal-codigo-wrap'),
    fieldCategoria: document.getElementById('fin-plano-modal-categoria'),
    fieldCategoriaWrap: document.getElementById('fin-plano-modal-categoria-wrap'),
    fieldAtivo: document.getElementById('fin-plano-modal-ativo'),
    btnCancel: document.getElementById('fin-plano-modal-cancel'),
    btnSave: document.getElementById('fin-plano-modal-save'),
    btnDelete: document.getElementById('fin-plano-modal-delete'),
  };

  let categorias = [];
  let planoContas = [];
  let activeTab = 'categorias';
  let editKind = null;
  let editId = null;
  let loading = false;

  function showFormErrors(msg) {
    if (!els.formErrors) return;
    if (!msg) {
      els.formErrors.classList.add('hidden');
      els.formErrors.textContent = '';
      return;
    }
    els.formErrors.textContent = msg;
    els.formErrors.classList.remove('hidden');
  }

  function setTab(tab) {
    activeTab = tab;
    els.tabs?.querySelectorAll('[data-fin-plano-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.finPlanoTab === tab);
    });
    els.panelCategorias?.classList.toggle('hidden', tab !== 'categorias');
    els.panelPlanos?.classList.toggle('hidden', tab !== 'planos');
  }

  function fillCategoriaSelect(selectedId = '') {
    if (!els.fieldCategoria) return;
    els.fieldCategoria.innerHTML =
      '<option value="">Selecione…</option>' +
      categorias
        .map(
          (c) =>
            `<option value="${c.id}"${Number(selectedId) === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`,
        )
        .join('');
  }

  function renderCategoriasTable() {
    if (!els.tableCategorias) return;
    if (!categorias.length) {
      els.tableCategorias.innerHTML =
        '<tr><td colspan="5" class="cell-empty">Nenhuma categoria cadastrada.</td></tr>';
      return;
    }
    els.tableCategorias.innerHTML = categorias
      .map(
        (c) => `
      <tr data-kind="categoria" data-id="${c.id}" class="${c.ativo ? '' : 'fin-catalog-row--inativo'}">
        <td><strong>${escapeHtml(c.nome)}</strong></td>
        <td>${c.usoPlanos || 0}</td>
        <td>${c.usoContas || 0}</td>
        <td>${statusBadge(c.ativo)}</td>
        <td class="row-actions">
          <button type="button" class="tbtn" data-action="edit">Editar</button>
          <button type="button" class="tbtn" data-action="toggle">${c.ativo ? 'Inativar' : 'Reativar'}</button>
          <button type="button" class="tbtn danger-text" data-action="delete"${c.usoContas ? ' disabled title="Há contas vinculadas"' : ''}>Excluir</button>
        </td>
      </tr>`,
      )
      .join('');
    bindTableActions(els.tableCategorias);
  }

  function renderPlanosTable() {
    if (!els.tablePlanos) return;
    if (!planoContas.length) {
      els.tablePlanos.innerHTML =
        '<tr><td colspan="6" class="cell-empty">Nenhum plano de contas cadastrado.</td></tr>';
      return;
    }
    els.tablePlanos.innerHTML = planoContas
      .map(
        (p) => `
      <tr data-kind="plano" data-id="${p.id}" class="${p.ativo ? '' : 'fin-catalog-row--inativo'}">
        <td>${escapeHtml(p.codigo || '—')}</td>
        <td><strong>${escapeHtml(p.nome)}</strong></td>
        <td>${escapeHtml(p.categoriaNome || '—')}</td>
        <td>${p.usoContas || 0}</td>
        <td>${statusBadge(p.ativo)}</td>
        <td class="row-actions">
          <button type="button" class="tbtn" data-action="edit">Editar</button>
          <button type="button" class="tbtn" data-action="toggle">${p.ativo ? 'Inativar' : 'Reativar'}</button>
          <button type="button" class="tbtn danger-text" data-action="delete"${p.usoContas ? ' disabled title="Há contas vinculadas"' : ''}>Excluir</button>
        </td>
      </tr>`,
      )
      .join('');
    bindTableActions(els.tablePlanos);
  }

  function bindTableActions(table) {
    table.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tr = btn.closest('tr[data-id]');
        if (!tr) return;
        const kind = tr.dataset.kind;
        const id = Number(tr.dataset.id);
        const item =
          kind === 'categoria'
            ? categorias.find((c) => c.id === id)
            : planoContas.find((p) => p.id === id);
        if (!item) return;
        const action = btn.dataset.action;
        if (action === 'edit') openModal(kind, item);
        else if (action === 'toggle') void toggleAtivo(kind, item);
        else if (action === 'delete') void removeItem(kind, item);
      });
    });
  }

  function renderSummary() {
    if (!els.summary) return;
    const catAtivas = categorias.filter((c) => c.ativo).length;
    const planoAtivos = planoContas.filter((p) => p.ativo).length;
    els.summary.textContent = `${catAtivas} categoria(s) ativa(s) · ${planoAtivos} plano(s) ativo(s)`;
  }

  function renderAll() {
    renderCategoriasTable();
    renderPlanosTable();
    renderSummary();
  }

  function openModal(kind, item = null) {
    editKind = kind;
    editId = item?.id ?? null;
    showFormErrors(null);

    const isPlano = kind === 'plano';
    els.fieldCodigoWrap?.classList.toggle('hidden', !isPlano);
    els.fieldCategoriaWrap?.classList.toggle('hidden', !isPlano);

    if (els.modalTitle) {
      if (editId) {
        els.modalTitle.textContent = isPlano ? 'Editar plano de contas' : 'Editar categoria';
      } else {
        els.modalTitle.textContent = isPlano ? 'Novo plano de contas' : 'Nova categoria';
      }
    }

    if (els.fieldNome) els.fieldNome.value = item?.nome || '';
    if (els.fieldCodigo) els.fieldCodigo.value = item?.codigo || '';
    if (els.fieldAtivo) els.fieldAtivo.checked = item ? Boolean(item.ativo) : true;
    if (isPlano) fillCategoriaSelect(item?.categoriaId || '');

    els.btnDelete?.classList.toggle('hidden', !editId);
    els.modalBg?.classList.add('open');
    els.fieldNome?.focus();
  }

  function closeModal() {
    editKind = null;
    editId = null;
    showFormErrors(null);
    els.modalBg?.classList.remove('open');
  }

  async function loadFinanceiroPlanoContas() {
    if (loading) return;
    loading = true;
    try {
      const [catRes, planoRes] = await Promise.all([
        fetchFinanceiroCategorias({ gestao: true }),
        fetchFinanceiroPlanoContas({ gestao: true }),
      ]);
      categorias = catRes?.categorias || [];
      planoContas = planoRes?.planoContas || [];
      renderAll();
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Falha ao carregar.';
    } finally {
      loading = false;
    }
  }

  async function saveModal() {
    const nome = els.fieldNome?.value?.trim() || '';
    if (!nome) {
      showFormErrors('Informe o nome.');
      els.fieldNome?.focus();
      return;
    }
    const ativo = Boolean(els.fieldAtivo?.checked);

    showFormErrors(null);
    els.btnSave.disabled = true;
    try {
      if (editKind === 'categoria') {
        if (editId) {
          await updateFinanceiroCategoria(editId, { nome, ativo });
        } else {
          await createFinanceiroCategoria({ nome, ativo });
        }
      } else {
        const categoriaId = Number(els.fieldCategoria?.value);
        if (!categoriaId) {
          showFormErrors('Selecione a categoria.');
          els.fieldCategoria?.focus();
          return;
        }
        const payload = {
          nome,
          ativo,
          categoriaId,
          codigo: els.fieldCodigo?.value?.trim() || '',
        };
        if (editId) {
          await updateFinanceiroPlanoConta(editId, payload);
        } else {
          await createFinanceiroPlanoConta(payload);
        }
      }
      closeModal();
      await loadFinanceiroPlanoContas();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
    }
  }

  async function toggleAtivo(kind, item) {
    const next = !item.ativo;
    const label = kind === 'categoria' ? item.nome : item.nome;
    const verb = next ? 'reativar' : 'inativar';
    if (!window.confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} "${label}"?`)) return;
    try {
      if (kind === 'categoria') {
        await updateFinanceiroCategoria(item.id, { ativo: next });
      } else {
        await updateFinanceiroPlanoConta(item.id, { ativo: next });
      }
      await loadFinanceiroPlanoContas();
    } catch (err) {
      window.alert(err.message || 'Não foi possível atualizar.');
    }
  }

  async function removeItem(kind, item) {
    if (item.usoContas > 0) {
      window.alert('Existem contas a pagar vinculadas. Inative em vez de excluir.');
      return;
    }
    const label = item.nome;
    if (!window.confirm(`Excluir "${label}" permanentemente?`)) return;
    try {
      if (kind === 'categoria') {
        await deleteFinanceiroCategoria(item.id);
      } else {
        await deleteFinanceiroPlanoConta(item.id);
      }
      await loadFinanceiroPlanoContas();
    } catch (err) {
      window.alert(err.message || 'Não foi possível excluir.');
    }
  }

  els.tabs?.querySelectorAll('[data-fin-plano-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.finPlanoTab));
  });

  els.btnNewCategoria?.addEventListener('click', () => openModal('categoria'));
  els.btnNewPlano?.addEventListener('click', () => openModal('plano'));
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveModal());
  els.btnDelete?.addEventListener('click', () => {
    if (!editId || !editKind) return;
    const item =
      editKind === 'categoria'
        ? categorias.find((c) => c.id === editId)
        : planoContas.find((p) => p.id === editId);
    if (item) void removeItem(editKind, item).then(() => closeModal());
  });

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  setTab('categorias');

  planoContasModuleInstance = { loadFinanceiroPlanoContas };
  return planoContasModuleInstance;
}
