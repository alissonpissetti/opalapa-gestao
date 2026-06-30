import { fetchUsers, createUser, updateUser, deleteUser, fetchPermissionGroups } from '../lib/api.js';
import { fmtDate, escapeHtml } from '../lib/format.js';

function formatPhone(phone) {
  if (!phone) return '—';
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

export function initUsersModule(currentUser) {
  const els = {
    table: document.getElementById('users-table'),
    summary: document.getElementById('users-summary'),
    btnNew: document.getElementById('btn-user-new'),
    modalBg: document.getElementById('user-modal-bg'),
    modalTitle: document.getElementById('user-modal-title'),
    modalSub: document.getElementById('user-modal-sub'),
    name: document.getElementById('u-name'),
    email: document.getElementById('u-email'),
    phone: document.getElementById('u-phone'),
    password: document.getElementById('u-password'),
    passwordHint: document.getElementById('u-password-hint'),
    permissionGroup: document.getElementById('u-permission-group'),
    btnCancel: document.getElementById('user-btn-cancel'),
    btnSave: document.getElementById('user-btn-save'),
    btnDelete: document.getElementById('user-btn-delete'),
  };

  let users = [];
  let permissionGroups = [];
  let editId = null;

  function renderPermissionGroupOptions(selectedId = '') {
    if (!els.permissionGroup) return;
    const opts = ['<option value="">Selecione um grupo</option>'];
    for (const group of permissionGroups) {
      opts.push(
        `<option value="${group.id}"${String(group.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(group.name)}</option>`,
      );
    }
    els.permissionGroup.innerHTML = opts.join('');
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

  function openModal(user = null) {
    editId = user?.id ?? null;
    const isEdit = editId != null;

    els.modalTitle.textContent = isEdit ? 'Editar usuário' : 'Novo usuário';
    els.modalSub.textContent = isEdit
      ? `Alterando ${user.name}`
      : 'Preencha os dados de acesso. Informe e-mail e/ou celular.';
    els.name.value = user?.name || '';
    els.email.value = user?.email || '';
    els.phone.value = user?.phone ? formatPhone(user.phone) : '';
    els.password.value = '';
    els.password.required = !isEdit;
    els.password.placeholder = isEdit ? 'Deixe em branco para manter' : 'Senha de acesso';
    els.passwordHint.textContent = isEdit
      ? 'Preencha apenas se quiser alterar a senha.'
      : 'Mínimo recomendado: 6 caracteres.';
    renderPermissionGroupOptions(user?.permissionGroupId || '');

    const isSelf = isEdit && editId === currentUser.id;
    els.btnDelete.classList.toggle('hidden', !isEdit || isSelf);

    els.modalBg.classList.add('open');
    els.name.focus();
  }

  function closeModal() {
    els.modalBg.classList.remove('open');
    editId = null;
  }

  function readForm() {
    return {
      name: els.name.value.trim(),
      email: els.email.value.trim(),
      phone: els.phone.value.replace(/\D/g, ''),
      password: els.password.value,
      permissionGroupId: els.permissionGroup?.value ? Number(els.permissionGroup.value) : null,
    };
  }

  async function loadUsers() {
    const [usersRes, groupsRes] = await Promise.all([fetchUsers(), fetchPermissionGroups()]);
    users = usersRes.users;
    permissionGroups = groupsRes.groups || [];
    renderPermissionGroupOptions();
    renderTable();
  }

  function renderTable() {
    if (!users.length) {
      els.table.innerHTML =
        '<tr><td colspan="5" class="cell-empty">Nenhum usuário cadastrado.</td></tr>';
      els.summary.textContent = '0 usuário(s)';
      return;
    }

    els.table.innerHTML = users
      .map((user) => {
        const isSelf = user.id === currentUser.id;
        return `
          <tr data-id="${user.id}">
            <td><strong>${escapeHtml(user.name)}</strong>${isSelf ? ' <span class="badge disp">você</span>' : ''}</td>
            <td class="${user.email ? '' : 'cell-empty'}">${user.email ? escapeHtml(user.email) : '—'}</td>
            <td class="${user.phone ? '' : 'cell-empty'}">${user.phone ? formatPhone(user.phone) : '—'}</td>
            <td class="${user.permissionGroupName ? '' : 'cell-empty'}">${user.permissionGroupName ? escapeHtml(user.permissionGroupName) : '—'}</td>
            <td class="cell-muted">${fmtDate(user.createdAt)}</td>
            <td class="row-actions">
              <button class="tbtn" type="button" data-action="edit" data-id="${user.id}">Editar</button>
              ${isSelf ? '' : `<button class="tbtn danger-text" type="button" data-action="delete" data-id="${user.id}">Excluir</button>`}
            </td>
          </tr>
        `;
      })
      .join('');

    els.summary.textContent = `${users.length} usuário(s) cadastrado(s)`;

    els.table.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const user = users.find((u) => u.id === Number(btn.dataset.id));
        if (user) openModal(user);
      });
    });

    els.table.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const user = users.find((u) => u.id === Number(btn.dataset.id));
        if (!user) return;
        if (!confirm(`Excluir o usuário "${user.name}"?`)) return;
        try {
          await deleteUser(user.id);
          await loadUsers();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const user = users.find((u) => u.id === Number(row.dataset.id));
        if (user) openModal(user);
      });
    });
  }

  async function saveUser() {
    const form = readForm();
    if (!editId && !form.permissionGroupId) {
      alert('Selecione um grupo de permissão.');
      return;
    }
    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      if (editId) {
        await updateUser(editId, form);
      } else {
        await createUser(form);
      }
      closeModal();
      await loadUsers();
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  async function removeUser() {
    if (!editId) return;
    const user = users.find((u) => u.id === editId);
    if (!user || !confirm(`Excluir o usuário "${user.name}"?`)) return;

    els.btnDelete.disabled = true;
    try {
      await deleteUser(editId);
      closeModal();
      await loadUsers();
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnDelete.disabled = false;
    }
  }

  els.btnNew.addEventListener('click', () => openModal());
  els.btnCancel.addEventListener('click', closeModal);
  els.btnSave.addEventListener('click', saveUser);
  els.btnDelete.addEventListener('click', removeUser);
  els.phone.addEventListener('input', (e) => maskPhoneInput(e.target));

  els.modalBg.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modalBg.classList.contains('open')) closeModal();
  });

  return { loadUsers };
}
