import { updateTarefaContato } from '../lib/api.js';
import { toDatetimeLocalValue } from '../lib/format.js';

export function initTarefaEditor({ onSaved } = {}) {
  const els = {
    modalBg: document.getElementById('tarefa-modal-bg'),
    title: document.getElementById('tarefa-modal-title'),
    sub: document.getElementById('tarefa-modal-sub'),
    data: document.getElementById('tarefa-modal-data'),
    obs: document.getElementById('tarefa-modal-obs'),
    btnCancel: document.getElementById('tarefa-modal-cancel'),
    btnSave: document.getElementById('tarefa-modal-save'),
  };

  let editId = null;

  function close() {
    els.modalBg?.classList.remove('open');
    editId = null;
  }

  function open(tarefa) {
    if (!tarefa?.id || tarefa.concluida) return;
    editId = tarefa.id;
    if (els.title) els.title.textContent = 'Editar tarefa';
    if (els.sub) {
      els.sub.textContent = tarefa.participanteNome
        ? `${tarefa.participanteNome}${tarefa.arrecadacaoDescricao ? ` · ${tarefa.arrecadacaoDescricao}` : ''}`
        : '';
    }
    if (els.data) els.data.value = toDatetimeLocalValue(tarefa.agendadoPara);
    if (els.obs) els.obs.value = tarefa.observacao || '';
    els.modalBg?.classList.add('open');
    els.data?.focus();
  }

  async function save() {
    if (!editId) return;
    const agendadoPara = els.data?.value || '';
    if (!agendadoPara) {
      alert('Informe data e hora do agendamento.');
      return;
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    try {
      await updateTarefaContato(editId, {
        agendadoPara,
        observacao: els.obs?.value.trim() || '',
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

  return { open, close };
}
