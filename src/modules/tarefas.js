import { fetchTarefasContato, concluirTarefaContato } from '../lib/api.js';
import { escapeHtml, fmtAgendado, fmtDate, isTarefaAtrasada } from '../lib/format.js';

function formatPhoneDisplay(phone) {
  if (!phone) return '';
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function whatsappLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const full = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${full}`;
}

function truncateText(text, max = 42) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const FILTER_KEY = 'tarefas-status-filter';
const FILTERS = new Set(['pendentes', 'atrasadas', 'concluidas', 'todas']);

const TAREFA_TIPO_LABELS = {
  presencial: 'Presencial',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao_online: 'Reunião online',
  outro: 'Outro',
};

function readStoredFilter() {
  const stored = localStorage.getItem(FILTER_KEY);
  return FILTERS.has(stored) ? stored : 'pendentes';
}

export function initTarefasModule({ onOpenLead, openTarefaEditor } = {}) {
  const els = {
    summary: document.getElementById('tarefas-summary'),
    table: document.getElementById('tarefas-table'),
    filters: document.getElementById('tarefas-filters'),
  };

  let tarefas = [];
  let filter = readStoredFilter();

  function setFilter(next) {
    filter = FILTERS.has(next) ? next : 'pendentes';
    localStorage.setItem(FILTER_KEY, filter);
    els.filters?.querySelectorAll('[data-tarefas-filter]').forEach((btn) => {
      const active = btn.dataset.tarefasFilter === filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function filteredTarefas() {
    if (filter === 'atrasadas') {
      return tarefas.filter((t) => isTarefaAtrasada(t.agendadoPara, t.concluida));
    }
    return tarefas;
  }

  function renderContatoCell(t) {
    const ig = t.participanteInstagram
      ? escapeHtml(
          t.participanteInstagram.startsWith('@')
            ? t.participanteInstagram
            : `@${t.participanteInstagram}`,
        )
      : '';
    const wa = t.participanteWhatsapp ? formatPhoneDisplay(t.participanteWhatsapp) : '';
    const waUrl = whatsappLink(t.participanteWhatsapp);
    const parts = [];
    if (ig) parts.push(`<span>${ig}</span>`);
    if (wa) {
      parts.push(
        waUrl
          ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(wa)}</a>`
          : escapeHtml(wa),
      );
    }
    return parts.length ? parts.join('<br>') : '—';
  }

  function renderQuandoCell(t) {
    if (t.concluida) {
      return `<span class="cell-muted">Concluída ${fmtDate(t.concluidaEm)}</span>`;
    }
    const atrasada = isTarefaAtrasada(t.agendadoPara, t.concluida);
    const label = fmtAgendado(t.agendadoPara);
    if (atrasada) {
      return `<strong class="tarefa-data-atrasada">${escapeHtml(label)}</strong><span class="tarefa-badge-atrasada">Atrasada</span>`;
    }
    return escapeHtml(label);
  }

  function renderTable() {
    const list = filteredTarefas();

    if (!list.length) {
      const emptyMsg =
        filter === 'atrasadas'
          ? 'Nenhuma tarefa atrasada.'
          : filter === 'concluidas'
            ? 'Nenhuma tarefa concluída.'
            : filter === 'todas'
              ? 'Nenhuma tarefa cadastrada.'
              : 'Nenhuma tarefa agendada. Crie follow-ups nos leads da arrecadação.';
      els.table.innerHTML = `<tr class="tarefa-empty-row"><td colspan="6" class="cell-empty">${emptyMsg}</td></tr>`;
      els.summary.textContent = '0 tarefa(s)';
      return;
    }

    const overdueCount = list.filter((t) => isTarefaAtrasada(t.agendadoPara, t.concluida)).length;
    let summary = `${list.length} tarefa(s)`;
    if (filter === 'pendentes' && overdueCount) {
      summary += ` · ${overdueCount} atrasada(s)`;
    }
    els.summary.textContent = summary;

    els.table.innerHTML = list
      .map((t) => {
        const atrasada = isTarefaAtrasada(t.agendadoPara, t.concluida);
        const tipoLabel = TAREFA_TIPO_LABELS[t.tipoTarefa] || t.tipoTarefa || '';
        const metaParts = [tipoLabel, t.responsavelNome].filter(Boolean);
        const metaHtml = metaParts.length
          ? `<div class="tarefa-card-meta">${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`
          : '';

        const hasContato = Boolean(t.participanteInstagram || t.participanteWhatsapp);
        const obsText = String(t.observacao || '').trim();

        const leadCell = t.arrecadacaoId
          ? `<button class="tbtn linkish" type="button" data-action="ver-lead" data-id="${t.arrecadacaoId}" data-arr-tipo="${escapeHtml(t.arrecadacaoTipo || '')}">${escapeHtml(truncateText(t.arrecadacaoDescricao || 'Ver lead', 36))}</button>`
          : '';

        const actions = t.concluida
          ? ''
          : `<button class="tbtn tbtn--compact" type="button" data-action="editar" data-id="${t.id}">Editar</button>
             <button class="tbtn tbtn--compact primary" type="button" data-action="concluir" data-id="${t.id}">Concluir</button>`;

        const rowClass = [
          'tarefa-card-row',
          atrasada ? 'tarefa-row-atrasada' : '',
          t.arrecadacaoId ? 'tarefa-row-clickable' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return `
        <tr
          class="${rowClass}"
          data-tarefa-id="${t.id}"
          ${t.arrecadacaoId ? `data-arrecadacao-id="${t.arrecadacaoId}" data-arrecadacao-tipo="${escapeHtml(t.arrecadacaoTipo || '')}"` : ''}
        >
          <td class="tarefa-cell-quando tarefa-quando-cell">${renderQuandoCell(t)}</td>
          <td class="tarefa-cell-participante">
            <strong class="tarefa-card-nome">${escapeHtml(t.participanteNome)}</strong>
            ${metaHtml}
          </td>
          <td class="tarefa-cell-lead${leadCell ? '' : ' tarefa-cell-lead--empty'}">${leadCell || '<span class="tarefa-cell-placeholder">—</span>'}</td>
          <td class="tarefa-cell-contato${hasContato ? '' : ' tarefa-cell-contato--empty'}">${hasContato ? renderContatoCell(t) : '<span class="tarefa-cell-placeholder">—</span>'}</td>
          <td class="tarefa-cell-obs${obsText ? ' cell-muted' : ' tarefa-cell-obs--empty'}">${obsText ? escapeHtml(obsText) : '<span class="tarefa-cell-placeholder">—</span>'}</td>
          <td class="tarefa-cell-acoes row-actions row-actions--tarefa">${actions}</td>
        </tr>`;
      })
      .join('');

    els.table.querySelectorAll('[data-action="concluir"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        concluirTarefa(Number(btn.dataset.id));
      });
    });

    els.table.querySelectorAll('[data-action="editar"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tarefa = tarefas.find((t) => t.id === Number(btn.dataset.id));
        if (tarefa && openTarefaEditor) openTarefaEditor(tarefa);
      });
    });

    els.table.querySelectorAll('[data-action="ver-lead"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        if (id && onOpenLead) onOpenLead(id, { tipo: btn.dataset.arrTipo || undefined });
      });
    });

    els.table.querySelectorAll('tr[data-arrecadacao-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        if (e.target.closest('a')) return;
        const id = Number(row.dataset.arrecadacaoId);
        if (!id || !onOpenLead) return;
        onOpenLead(id, { tipo: row.dataset.arrecadacaoTipo || undefined });
      });
    });
  }

  async function concluirTarefa(id) {
    if (!id) return;
    try {
      await concluirTarefaContato(id);
      await loadTarefas();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadTarefas() {
    const apiStatus = filter === 'atrasadas' ? 'pendentes' : filter;
    const data = await fetchTarefasContato({ status: apiStatus });
    tarefas = data.tarefas || [];
    renderTable();
  }

  els.filters?.querySelectorAll('[data-tarefas-filter]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setFilter(btn.dataset.tarefasFilter);
      await loadTarefas();
    });
  });

  setFilter(filter);

  return { loadTarefas };
}
