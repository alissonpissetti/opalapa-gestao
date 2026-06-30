import {
  fetchPermissionGroups,
  fetchPermissionCatalog,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
} from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { groupCatalogByArea } from '../lib/permissions.js';

export function initPermissoesModule() {
  const els = {
    summary: document.getElementById('permissoes-summary'),
    table: document.getElementById('permissoes-table'),
    btnNew: document.getElementById('btn-permissoes-new'),
    modalBg: document.getElementById('permissoes-modal-bg'),
    modalTitle: document.getElementById('permissoes-modal-title'),
    modalSub: document.getElementById('permissoes-modal-sub'),
    formErrors: document.getElementById('permissoes-modal-errors'),
    fieldName: document.getElementById('permissoes-modal-name'),
    fieldDescription: document.getElementById('permissoes-modal-description'),
    viewsWrap: document.getElementById('permissoes-modal-views'),
    btnCancel: document.getElementById('permissoes-modal-cancel'),
    btnSave: document.getElementById('permissoes-modal-save'),
    btnDelete: document.getElementById('permissoes-modal-delete'),
  };

  let groups = [];
  let catalog = [];
  let editId = null;

  function viewsSummary(views = []) {
    if (!views.length) return 'Nenhuma tela';
    const labels = views.map((key) => catalog.find((item) => item.key === key)?.label || key);
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.length} telas`;
  }

  function showFormErrors(message) {
    if (!els.formErrors) return;
    if (!message) {
      els.formErrors.classList.add('hidden');
      els.formErrors.textContent = '';
      return;
    }
    els.formErrors.textContent = message;
    els.formErrors.classList.remove('hidden');
  }

  function renderViewsCheckboxes(selected = []) {
    if (!els.viewsWrap) return;
    if (!catalog.length) {
      els.viewsWrap.innerHTML =
        '<p class="cell-empty">Não foi possível carregar a lista de telas. Recarregue a página.</p>';
      return;
    }
    const selectedSet = new Set(selected);
    const grouped = groupCatalogByArea(catalog);
    els.viewsWrap.innerHTML = grouped
      .map(
        ({ area, items }) => `
        <fieldset class="permissoes-area">
          <legend>${escapeHtml(area)}</legend>
          <div class="permissoes-area-grid">
            ${items
              .map(
                (item) => `
              <label class="permissoes-check">
                <input type="checkbox" name="perm-view" value="${escapeHtml(item.key)}"${
                  selectedSet.has(item.key) ? ' checked' : ''
                } />
                <span>${escapeHtml(item.label)}</span>
              </label>`,
              )
              .join('')}
          </div>
        </fieldset>`,
      )
      .join('');
  }

  function readSelectedViews() {
    return [...els.viewsWrap.querySelectorAll('input[name="perm-view"]:checked')].map(
      (input) => input.value,
    );
  }

  async function ensureCatalog() {
    if (catalog.length) return;
    const catalogRes = await fetchPermissionCatalog();
    catalog = catalogRes.catalog || [];
  }

  async function openModal(group = null) {
    try {
      await ensureCatalog();
    } catch (err) {
      showFormErrors(err.message || 'Falha ao carregar telas disponíveis.');
      return;
    }

    editId = group?.id ?? null;
    const isEdit = editId != null;
    const isSystem = Boolean(group?.isSystem);

    showFormErrors(null);
    els.modalTitle.textContent = isEdit ? 'Editar grupo' : 'Novo grupo';
    els.modalSub.textContent = isEdit
      ? isSystem
        ? 'Grupo do sistema — apenas a descrição pode ser alterada.'
        : `Alterando ${group.name}`
      : 'Defina o nome e marque as telas que este grupo pode acessar.';

    els.fieldName.value = group?.name || '';
    els.fieldName.disabled = isSystem;
    els.fieldDescription.value = group?.description || '';
    renderViewsCheckboxes(group?.views || []);

    els.viewsWrap.querySelectorAll('input').forEach((input) => {
      input.disabled = isSystem;
    });

    els.btnDelete.classList.toggle('hidden', !isEdit || isSystem);
    els.modalBg.classList.add('open');
    if (!isSystem) els.fieldName.focus();
  }

  function closeModal() {
    editId = null;
    showFormErrors(null);
    els.fieldName.disabled = false;
    els.modalBg.classList.remove('open');
  }

  function renderTable() {
    if (!groups.length) {
      els.table.innerHTML =
        '<tr><td colspan="5" class="cell-empty">Nenhum grupo cadastrado.</td></tr>';
      els.summary.textContent = '0 grupo(s)';
      return;
    }

    els.table.innerHTML = groups
      .map(
        (group) => `
        <tr data-id="${group.id}">
          <td><strong>${escapeHtml(group.name)}</strong>${group.isSystem ? ' <span class="badge disp">sistema</span>' : ''}</td>
          <td class="${group.description ? '' : 'cell-empty'}">${group.description ? escapeHtml(group.description) : '—'}</td>
          <td>${escapeHtml(viewsSummary(group.views))}</td>
          <td>${group.userCount || 0}</td>
          <td class="row-actions">
            <button class="tbtn" type="button" data-action="edit" data-id="${group.id}">Editar</button>
            ${
              group.isSystem
                ? ''
                : `<button class="tbtn danger-text" type="button" data-action="delete" data-id="${group.id}">Excluir</button>`
            }
          </td>
        </tr>`,
      )
      .join('');

    els.summary.textContent = `${groups.length} grupo(s) de permissão`;

    els.table.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const group = groups.find((g) => g.id === Number(btn.dataset.id));
        if (group) void openModal(group);
      });
    });

    els.table.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const group = groups.find((g) => g.id === Number(btn.dataset.id));
        if (!group || !confirm(`Excluir o grupo "${group.name}"?`)) return;
        try {
          await deletePermissionGroup(group.id);
          await loadPermissoes();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const group = groups.find((g) => g.id === Number(row.dataset.id));
        if (group) void openModal(group);
      });
    });
  }

  async function loadPermissoes() {
    try {
      const [groupsRes, catalogRes] = await Promise.all([
        fetchPermissionGroups(),
        fetchPermissionCatalog(),
      ]);
      groups = groupsRes.groups || [];
      catalog = catalogRes.catalog || [];
      renderTable();
    } catch (err) {
      if (els.summary) {
        els.summary.textContent = err.message || 'Falha ao carregar grupos.';
      }
      groups = [];
      renderTable();
    }
  }

  async function saveGroup() {
    const payload = {
      name: els.fieldName.value.trim(),
      description: els.fieldDescription.value.trim(),
      views: readSelectedViews(),
    };

    if (!payload.name) {
      showFormErrors('Informe o nome do grupo.');
      els.fieldName.focus();
      return;
    }
    if (!payload.views.length && !groups.find((g) => g.id === editId)?.isSystem) {
      showFormErrors('Selecione ao menos uma tela.');
      return;
    }

    showFormErrors(null);
    els.btnSave.disabled = true;
    try {
      if (editId) {
        await updatePermissionGroup(editId, payload);
      } else {
        await createPermissionGroup(payload);
      }
      closeModal();
      await loadPermissoes();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
    }
  }

  els.btnNew?.addEventListener('click', () => void openModal());
  els.btnCancel?.addEventListener('click', closeModal);
  els.btnSave?.addEventListener('click', () => void saveGroup());
  els.btnDelete?.addEventListener('click', async () => {
    if (!editId) return;
    const group = groups.find((g) => g.id === editId);
    if (!group || !confirm(`Excluir o grupo "${group.name}"?`)) return;
    try {
      await deletePermissionGroup(editId);
      closeModal();
      await loadPermissoes();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível excluir.');
    }
  });

  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  return { loadPermissoes };
}
