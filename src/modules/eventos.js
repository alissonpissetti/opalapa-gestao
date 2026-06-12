import {
  fetchEventos,
  createEvento,
  updateEvento,
  deleteEvento,
  fetchEventoComparacao,
} from '../lib/api.js';
import { getActiveEvento, setActiveEvento } from '../lib/evento.js';
import { fmtDate, fmtMoney, escapeHtml } from '../lib/format.js';

function fmtDelta({ diff, pct }) {
  const sign = diff > 0 ? '+' : '';
  const pctStr = Number.isFinite(pct) ? ` (${sign}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : '';
  return `${sign}${diff.toLocaleString('pt-BR')}${pctStr}`;
}

function fmtMoneyDelta({ diff, pct }) {
  const sign = diff > 0 ? '+' : '';
  const pctStr = Number.isFinite(pct) ? ` (${sign}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : '';
  return `${sign}${fmtMoney(diff).replace('R$', 'R$ ')}${pctStr}`;
}

export function initEventoSelector({ onChange }) {
  const select = document.getElementById('evento-select');
  if (!select) return { refresh: async () => {} };

  async function refresh(eventos) {
    const list = eventos || (await fetchEventos()).eventos || [];
    const active = getActiveEvento();
    select.innerHTML = list
      .map(
        (e) =>
          `<option value="${e.id}" ${e.id === active?.id ? 'selected' : ''}>${escapeHtml(e.nome)} (${e.edicao})</option>`,
      )
      .join('');
    return list;
  }

  select.addEventListener('change', () => {
    const id = Number(select.value);
    const option = select.selectedOptions[0];
    if (!id) return;
    const nome = option?.textContent?.replace(/\s*\(\d+\)$/, '') || '';
    const edicao = Number(option?.textContent?.match(/\((\d+)\)$/)?.[1]);
    setActiveEvento({ id, nome, edicao });
    onChange?.();
  });

  return { refresh };
}

export function initEventosModule({ onEventosChanged }) {
  const els = {
    table: document.getElementById('eventos-table'),
    summary: document.getElementById('eventos-summary'),
    comparacao: document.getElementById('eventos-comparacao'),
    btnNew: document.getElementById('btn-evento-new'),
    modalBg: document.getElementById('evento-modal-bg'),
    modalTitle: document.getElementById('evento-modal-title'),
    nome: document.getElementById('ev-nome'),
    edicao: document.getElementById('ev-edicao'),
    anterior: document.getElementById('ev-anterior'),
    btnCancel: document.getElementById('evento-btn-cancel'),
    btnSave: document.getElementById('evento-btn-save'),
    btnDelete: document.getElementById('evento-btn-delete'),
  };

  let eventos = [];
  let editId = null;
  let comparacaoId = null;

  function openModal(evento = null) {
    editId = evento?.id ?? null;
    els.modalTitle.textContent = evento ? 'Editar evento' : 'Novo evento';
    els.nome.value = evento?.nome || '';
    els.edicao.value = evento?.edicao || new Date().getFullYear();
    els.anterior.innerHTML =
      '<option value="">— Nenhuma —</option>' +
      eventos
        .filter((e) => e.id !== editId)
        .map(
          (e) =>
            `<option value="${e.id}" ${evento?.eventoAnteriorId === e.id ? 'selected' : ''}>${escapeHtml(e.nome)} (${e.edicao})</option>`,
        )
        .join('');
    els.btnDelete?.classList.toggle('hidden', !evento);
    els.modalBg?.classList.add('open');
    els.nome?.focus();
  }

  function closeModal() {
    els.modalBg?.classList.remove('open');
    editId = null;
  }

  function renderTable() {
    if (!els.table) return;
    els.summary.textContent = `${eventos.length} evento(s) cadastrado(s)`;
    els.table.innerHTML = eventos
      .map((e) => {
        const anterior = e.eventoAnteriorNome
          ? `${escapeHtml(e.eventoAnteriorNome)}`
          : '—';
        const isActive = getActiveEvento()?.id === e.id;
        return `<tr data-id="${e.id}">
          <td>${escapeHtml(e.nome)}${isActive ? ' <span class="badge badge-active">Ativo</span>' : ''}</td>
          <td>${e.edicao}</td>
          <td>${anterior}</td>
          <td>${fmtDate(e.createdAt)}</td>
          <td class="row-actions-icons">
            <button type="button" class="icon-btn" data-action="comparar" title="Comparar com edição anterior" aria-label="Comparar">📊</button>
            <button type="button" class="icon-btn" data-action="ativar" title="Usar este evento" aria-label="Ativar">✓</button>
            <button type="button" class="icon-btn" data-action="editar" title="Editar" aria-label="Editar">✎</button>
            <button type="button" class="icon-btn" data-action="excluir" title="Excluir" aria-label="Excluir">🗑</button>
          </td>
        </tr>`;
      })
      .join('');
  }

  async function renderComparacao(id) {
    if (!els.comparacao) return;
    comparacaoId = id;
    els.comparacao.innerHTML = '<p class="subtitle">Carregando comparação…</p>';
    try {
      const data = await fetchEventoComparacao(id);
      const { evento, atual, anterior, comparacao, eventoAnterior } = data;

      if (!anterior || !comparacao) {
        els.comparacao.innerHTML = `
          <h2>Comparação — ${escapeHtml(evento.nome)} (${evento.edicao})</h2>
          <p class="subtitle">Este evento não tem edição anterior vinculada para comparação.</p>
          <div class="evento-stats-grid">
            ${statCard('Espaços ocupados', atual.espacosOcupados, atual.totalEspacos)}
            ${statCard('Vendidos', atual.espacosVendidos)}
            ${statCard('Participantes', atual.participantes)}
            ${statCardMoney('Arrecadação total', atual.arrecadacaoTotal)}
            ${statCardMoney('Recebido', atual.arrecadacaoPago)}
            ${statCardMoney('A receber', atual.arrecadacaoFalta)}
          </div>`;
        return;
      }

      els.comparacao.innerHTML = `
        <h2>Comparação — ${escapeHtml(evento.nome)} (${evento.edicao})</h2>
        <p class="subtitle">vs. ${escapeHtml(eventoAnterior?.nome || '')} (${eventoAnterior?.edicao || ''})</p>
        <div class="evento-stats-grid">
          ${compareCard('Espaços ocupados', atual.espacosOcupados, comparacao.espacosOcupados)}
          ${compareCard('Vendidos', atual.espacosVendidos, comparacao.espacosVendidos)}
          ${compareCard('Participantes', atual.participantes, comparacao.participantes)}
          ${compareCardMoney('Arrecadação total', atual.arrecadacaoTotal, comparacao.arrecadacaoTotal)}
          ${compareCardMoney('Recebido', atual.arrecadacaoPago, comparacao.arrecadacaoPago)}
          ${compareCardMoney('Valor negociado (espaços)', atual.valorNegociado, comparacao.valorNegociado)}
        </div>`;
    } catch (err) {
      els.comparacao.innerHTML = `<p class="login-error">${escapeHtml(err.message)}</p>`;
    }
  }

  function statCard(label, value, total = null) {
    const sub = total != null ? `<span class="stat-sub">de ${total}</span>` : '';
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub}</div>`;
  }

  function statCardMoney(label, value) {
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${fmtMoney(value)}</span></div>`;
  }

  function compareCard(label, atual, delta) {
    const cls = delta.diff > 0 ? 'delta-up' : delta.diff < 0 ? 'delta-down' : 'delta-neutral';
    return `<div class="stat">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${atual}</span>
      <span class="stat-delta ${cls}">${fmtDelta(delta)}</span>
    </div>`;
  }

  function compareCardMoney(label, atual, delta) {
    const cls = delta.diff > 0 ? 'delta-up' : delta.diff < 0 ? 'delta-down' : 'delta-neutral';
    return `<div class="stat">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${fmtMoney(atual)}</span>
      <span class="stat-delta ${cls}">${fmtMoneyDelta(delta)}</span>
    </div>`;
  }

  async function loadEventos() {
    const data = await fetchEventos();
    eventos = data.eventos || [];
    renderTable();
    if (comparacaoId) await renderComparacao(comparacaoId);
    return eventos;
  }

  els.btnNew?.addEventListener('click', () => openModal());
  els.btnCancel?.addEventListener('click', closeModal);
  els.modalBg?.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.btnSave?.addEventListener('click', async () => {
    const body = {
      nome: els.nome.value.trim(),
      edicao: Number(els.edicao.value),
      eventoAnteriorId: els.anterior.value ? Number(els.anterior.value) : null,
    };
    try {
      if (editId) await updateEvento(editId, body);
      else await createEvento(body);
      closeModal();
      await loadEventos();
      await onEventosChanged?.();
    } catch (err) {
      alert(err.message);
    }
  });

  els.btnDelete?.addEventListener('click', async () => {
    if (!editId) return;
    const ev = eventos.find((e) => e.id === editId);
    if (!confirm(`Excluir o evento "${ev?.nome}"? Todos os espaços e arrecadação desta edição serão removidos.`)) return;
    try {
      await deleteEvento(editId);
      closeModal();
      if (comparacaoId === editId) {
        comparacaoId = null;
        if (els.comparacao) els.comparacao.innerHTML = '';
      }
      await loadEventos();
      await onEventosChanged?.();
    } catch (err) {
      alert(err.message);
    }
  });

  els.table?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('tr[data-id]');
    const id = Number(row?.dataset.id);
    const ev = eventos.find((x) => x.id === id);
    if (!ev) return;

    if (btn.dataset.action === 'editar') openModal(ev);
    if (btn.dataset.action === 'comparar') await renderComparacao(id);
    if (btn.dataset.action === 'ativar') {
      setActiveEvento(ev);
      document.getElementById('evento-select').value = String(id);
      await onEventosChanged?.();
      renderTable();
    }
    if (btn.dataset.action === 'excluir') {
      if (!confirm(`Excluir o evento "${ev.nome}"? Todos os espaços e arrecadação desta edição serão removidos.`)) return;
      try {
        await deleteEvento(id);
        if (comparacaoId === id) {
          comparacaoId = null;
          if (els.comparacao) els.comparacao.innerHTML = '';
        }
        await loadEventos();
        await onEventosChanged?.();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  return { loadEventos, renderComparacao };
}
