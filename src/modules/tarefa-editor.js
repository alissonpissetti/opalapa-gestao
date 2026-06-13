import { updateTarefaContato, fetchUsers } from '../lib/api.js';
import { combineDateAndTime, splitAgendadoInputs } from '../lib/format.js';

const TAREFA_TIPO_LABELS = {
  presencial: 'Presencial',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao_online: 'Reunião online',
  outro: 'Outro',
};

export function initTarefaEditor({ onSaved } = {}) {
  const els = {
    modalBg: document.getElementById('tarefa-modal-bg'),
    title: document.getElementById('tarefa-modal-title'),
    sub: document.getElementById('tarefa-modal-sub'),
    nome: document.getElementById('tarefa-modal-nome'),
    data: document.getElementById('tarefa-modal-data'),
    hora: document.getElementById('tarefa-modal-hora'),
    tipo: document.getElementById('tarefa-modal-tipo'),
    responsavel: document.getElementById('tarefa-modal-responsavel'),
    btnCancel: document.getElementById('tarefa-modal-cancel'),
    btnSave: document.getElementById('tarefa-modal-save'),
  };

  let editId = null;
  let usuarios = [];

  function renderResponsavelOptions(selectedId = null) {
    if (!els.responsavel) return;
    const current = selectedId != null ? String(selectedId) : '';
    els.responsavel.innerHTML =
      '<option value="">Selecione</option>' +
      usuarios
        .map(
          (u) =>
            `<option value="${u.id}"${String(u.id) === current ? ' selected' : ''}>${u.name}</option>`,
        )
        .join('');
  }

  async function ensureUsuarios(list) {
    if (list?.length) {
      usuarios = list;
      return;
    }
    if (usuarios.length) return;
    try {
      const data = await fetchUsers();
      usuarios = data.users || [];
    } catch (_) {
      usuarios = [];
    }
  }

  function close() {
    els.modalBg?.classList.remove('open');
    editId = null;
  }

  async function open(tarefa, { usuarios: usuariosList } = {}) {
    if (!tarefa?.id || tarefa.concluida) return;
    await ensureUsuarios(usuariosList);

    editId = tarefa.id;
    if (els.title) els.title.textContent = 'Editar tarefa';
    if (els.sub) {
      els.sub.textContent = tarefa.participanteNome
        ? `${tarefa.participanteNome}${tarefa.arrecadacaoDescricao ? ` · ${tarefa.arrecadacaoDescricao}` : ''}`
        : '';
    }
    if (els.nome) els.nome.value = tarefa.observacao || '';
    const { date, time } = splitAgendadoInputs(tarefa.agendadoPara);
    if (els.data) els.data.value = date;
    if (els.hora) els.hora.value = time;
    if (els.tipo) els.tipo.value = tarefa.tipoTarefa || '';
    renderResponsavelOptions(tarefa.responsavelId);
    els.modalBg?.classList.add('open');
    els.nome?.focus();
  }

  async function save() {
    if (!editId) return;

    const observacao = els.nome?.value.trim() || '';
    const agendadoPara = combineDateAndTime(els.data?.value, els.hora?.value);
    const tipoTarefa = els.tipo?.value || '';
    const responsavelId = Number(els.responsavel?.value) || null;

    if (!observacao) {
      alert('Informe o nome da tarefa.');
      return;
    }
    if (!agendadoPara) {
      alert('Informe data e hora do agendamento.');
      return;
    }
    if (!tipoTarefa) {
      alert('Selecione o tipo de tarefa.');
      return;
    }
    if (!responsavelId) {
      alert('Selecione o responsável pela tarefa.');
      return;
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      await updateTarefaContato(editId, {
        agendadoPara,
        observacao,
        tipoTarefa,
        responsavelId,
      });
      close();
      await onSaved?.(editId);
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  els.btnCancel?.addEventListener('click', close);
  els.btnSave?.addEventListener('click', save);
  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modalBg?.classList.contains('open')) close();
  });

  return { open, close, TAREFA_TIPO_LABELS };
}
