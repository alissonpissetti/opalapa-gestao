import { fetchProducaoEntregas, patchProducaoEntrega } from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';

const FILTERS_STORAGE_KEY = 'entregas-filters';

function readFiltersState() {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      sort: ['nome', 'plano', 'espaco'].includes(parsed.sort) ? parsed.sort : 'nome',
      show: parsed.show === 'pendencias' ? 'pendencias' : 'todos',
      plano: parsed.plano != null ? String(parsed.plano) : '',
    };
  } catch {
    return null;
  }
}

function writeFiltersState(state) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function hasPending(item) {
  return countPending(item) > 0;
}

function sortItems(list, sortKey) {
  const sorted = [...list];
  const byNome = (a, b) =>
    (a.participanteNome || '').localeCompare(b.participanteNome || '', 'pt-BR');

  if (sortKey === 'plano') {
    sorted.sort(
      (a, b) =>
        (a.produtoOrdem ?? 999) - (b.produtoOrdem ?? 999) ||
        (a.produtoNome || '').localeCompare(b.produtoNome || '', 'pt-BR') ||
        byNome(a, b),
    );
  } else if (sortKey === 'espaco') {
    sorted.sort(
      (a, b) =>
        (a.espacos || '').localeCompare(b.espacos || '', 'pt-BR') || byNome(a, b),
    );
  } else {
    sorted.sort(byNome);
  }
  return sorted;
}

function countPending(item) {
  let pending = item.envioMarca ? 0 : 1;
  const ativos = item.beneficiosAtivos || {};
  const concluidos = item.beneficiosConcluidos || {};
  for (const [key, active] of Object.entries(ativos)) {
    if (active && !concluidos[key]) pending += 1;
  }
  return pending;
}

function countTotalChecklist(item) {
  let total = 1;
  const ativos = item.beneficiosAtivos || {};
  for (const active of Object.values(ativos)) {
    if (active) total += 1;
  }
  return total;
}

export function initProducaoEntregasModule({ onOpenLead } = {}) {
  const els = {
    summary: document.getElementById('entregas-summary'),
    sort: document.getElementById('entregas-sort'),
    filterShow: document.getElementById('entregas-filter-show'),
    filterPlano: document.getElementById('entregas-filter-plano'),
    thead: document.getElementById('entregas-thead'),
    table: document.getElementById('entregas-table'),
  };

  const savedFilters = readFiltersState();
  if (savedFilters) {
    if (els.sort) els.sort.value = savedFilters.sort;
    if (els.filterShow) els.filterShow.value = savedFilters.show;
    if (els.filterPlano && savedFilters.plano) els.filterPlano.value = savedFilters.plano;
  }

  let items = [];
  let beneficiosDef = [];
  let beneficiosColunas = [];
  let saving = new Set();
  let bulkUpdating = false;

  function beneficioLabel(key) {
    return beneficiosDef.find((b) => b.key === key)?.label || key;
  }

  function persistFilters() {
    writeFiltersState({
      sort: els.sort?.value || 'nome',
      show: els.filterShow?.value || 'todos',
      plano: els.filterPlano?.value || '',
    });
  }

  function getVisibleItems() {
    const filterId = els.filterPlano?.value ? Number(els.filterPlano.value) : null;
    const showPendingOnly = els.filterShow?.value === 'pendencias';
    const sortKey = els.sort?.value || 'nome';

    let visible = filterId ? items.filter((item) => item.produtoId === filterId) : [...items];
    if (showPendingOnly) {
      visible = visible.filter(hasPending);
    }
    return sortItems(visible, sortKey);
  }

  function getEligibleItems(kind, beneficioKey) {
    const visible = getVisibleItems();
    if (kind === 'marca') return visible;
    return visible.filter((item) => item.beneficiosAtivos?.[beneficioKey]);
  }

  function getPendingEligibleItems(kind, beneficioKey) {
    const eligible = getEligibleItems(kind, beneficioKey);
    if (kind === 'marca') return eligible.filter((item) => !item.envioMarca);
    return eligible.filter((item) => !item.beneficiosConcluidos?.[beneficioKey]);
  }

  function updateItemFromResponse(updated) {
    if (!updated?.item) return;
    const idx = items.findIndex((i) => i.arrecadacaoId === updated.item.arrecadacaoId);
    if (idx >= 0) {
      items[idx] = updated.item;
      return;
    }
    const byPart = items.findIndex((i) => i.participanteId === updated.item.participanteId);
    if (byPart >= 0) items[byPart] = updated.item;
  }

  function renderSelectAllHeader(label, kind, beneficioKey = '') {
    const dataAttrs =
      kind === 'marca'
        ? 'data-kind="marca"'
        : `data-kind="beneficio" data-beneficio="${escapeHtml(beneficioKey)}"`;
    return `
      <div class="entregas-th-check-inner">
        <span class="entregas-th-check-label">${escapeHtml(label)}</span>
        <button type="button" class="entregas-select-all" ${dataAttrs}
          title="Marcar todos os elegíveis">Todos</button>
      </div>`;
  }

  function renderFilterPlanos() {
    if (!els.filterPlano) return;
    const planos = new Map();
    for (const item of items) {
      if (item.produtoId && item.produtoNome) {
        planos.set(item.produtoId, { nome: item.produtoNome, ordem: item.produtoOrdem ?? 999 });
      }
    }
    const current = els.filterPlano.value;
    const options = [
      '<option value="">Todos os planos</option>',
      ...[...planos.entries()]
        .sort((a, b) => a[1].ordem - b[1].ordem || a[1].nome.localeCompare(b[1].nome, 'pt-BR'))
        .map(([id, { nome }]) => `<option value="${id}">${escapeHtml(nome)}</option>`),
    ];
    els.filterPlano.innerHTML = options.join('');
    if (current && planos.has(Number(current))) {
      els.filterPlano.value = current;
    }
  }

  function renderHeader() {
    if (!els.thead) return;
    const beneficioHeaders = beneficiosColunas
      .map((key) => {
        const label = beneficioLabel(key);
        return `<th class="entregas-th-beneficio entregas-th-check" title="${escapeHtml(label)}">
          ${renderSelectAllHeader(label, 'beneficio', key)}
        </th>`;
      })
      .join('');
    els.thead.innerHTML = `
      <tr>
        <th class="entregas-th-sticky-left entregas-th-participante">Participante</th>
        <th class="entregas-th-sticky-left entregas-th-plano">Plano</th>
        <th class="entregas-th-sticky-left entregas-th-espacos">Espaços</th>
        <th class="entregas-th-progress">Progresso</th>
        <th class="entregas-th-ingressos">Ingressos cortesia</th>
        <th class="entregas-th-marca entregas-th-check">${renderSelectAllHeader('Envio da marca', 'marca')}</th>
        ${beneficioHeaders}
      </tr>`;
    bindHeaderActions();
  }

  function bindHeaderActions() {
    els.thead?.querySelectorAll('.entregas-select-all').forEach((btn) => {
      btn.addEventListener('click', () => void handleSelectAll(btn));
    });
  }

  function renderIngressosCortesiaCell(item) {
    const disabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:ingressos`);
    const value = item.ingressosCortesia ?? 0;
    return `
      <td class="entregas-cell-ingressos">
        <input type="number" class="entregas-ingressos-input" data-kind="ingressos" data-id="${item.arrecadacaoId}"
          min="0" step="1" inputmode="numeric" placeholder="0" value="${value}"
          aria-label="Ingressos cortesia" ${disabled ? 'disabled' : ''} />
      </td>`;
  }

  function renderMarcaCell(item) {
    const disabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:marca`);
    return `
      <td class="entregas-cell-marca entrega-cell-check">
        <input type="checkbox" data-kind="marca" data-id="${item.arrecadacaoId}"
          aria-label="Envio da marca"
          ${item.envioMarca ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      </td>`;
  }

  function renderBeneficioCell(item, key) {
    if (!item.beneficiosAtivos?.[key]) {
      return `<td class="entrega-cell-na" aria-label="Não incluído no plano">—</td>`;
    }
    const checked = Boolean(item.beneficiosConcluidos?.[key]);
    const disabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:${key}`);
    return `
      <td class="entrega-cell-check">
        <input type="checkbox" data-kind="beneficio" data-id="${item.arrecadacaoId}" data-beneficio="${key}"
          aria-label="${escapeHtml(beneficioLabel(key))}"
          ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      </td>`;
  }

  function renderTable() {
    const visible = getVisibleItems();
    const colCount = 6 + beneficiosColunas.length;

    if (!visible.length) {
      els.table.innerHTML = `<tr class="entregas-empty-row"><td colspan="${colCount}" class="cell-empty">Nenhum lead fechado encontrado.</td></tr>`;
      const showPendingOnly = els.filterShow?.value === 'pendencias';
      const hasPlanoFilter = Boolean(els.filterPlano?.value);
      if (items.length && (showPendingOnly || hasPlanoFilter)) {
        els.summary.textContent = '0 participante(s) com o filtro atual';
      } else {
        els.summary.textContent = '0 participante(s) fechado(s)';
      }
      return;
    }

    els.table.innerHTML = visible
      .map((item) => {
        const plano = item.produtoNome
          ? `<span class="badge entrega-plano-badge">${escapeHtml(item.produtoNome)}</span>`
          : '<span class="cell-empty">—</span>';
        const espacos = item.espacos
          ? escapeHtml(item.espacos)
          : '<span class="cell-empty">—</span>';
        const total = countTotalChecklist(item);
        const pending = countPending(item);
        const progress =
          pending === 0
            ? '<span class="badge entrega-progress entrega-progress--done">Completo</span>'
            : `<span class="badge entrega-progress">${total - pending}/${total}</span>`;

        const beneficioCells = beneficiosColunas
          .map((key) => renderBeneficioCell(item, key))
          .join('');

        const participanteCell = `
          <button type="button" class="entregas-participante-link"
            data-arrecadacao-id="${item.arrecadacaoId}"
            title="Abrir lead">${escapeHtml(item.participanteNome)}</button>`;

        return `
          <tr data-id="${item.arrecadacaoId}" data-participante="${item.participanteId}" class="entregas-card-row">
            <td class="entregas-cell-sticky-left entregas-cell-nome">${participanteCell}</td>
            <td class="entregas-cell-sticky-left entregas-cell-plano">${plano}</td>
            <td class="entregas-cell-sticky-left entregas-cell-espaco">${espacos}</td>
            <td class="entregas-cell-progress">${progress}</td>
            ${renderIngressosCortesiaCell(item)}
            ${renderMarcaCell(item)}
            ${beneficioCells}
          </tr>`;
      })
      .join('');

    const complete = visible.filter((item) => countPending(item) === 0).length;
    const showPendingOnly = els.filterShow?.value === 'pendencias';
    let summary = `${visible.length} participante(s) fechado(s)`;
    if (showPendingOnly) {
      summary += ' com pendências';
    } else {
      summary += ` · ${complete} com checklist completo`;
    }
    els.summary.textContent = summary;

    els.table.querySelectorAll('.entregas-participante-link').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.arrecadacaoId);
        if (id && onOpenLead) onOpenLead(id);
      });
    });

    els.table.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => handleToggle(input));
    });

    els.table.querySelectorAll('.entregas-ingressos-input').forEach((input) => {
      input.addEventListener('change', () => void handleIngressosCortesia(input));
    });

    els.thead?.querySelectorAll('.entregas-select-all').forEach((btn) => {
      btn.disabled = bulkUpdating;
    });
  }

  async function handleSelectAll(btn) {
    if (bulkUpdating) return;

    const kind = btn.dataset.kind;
    const beneficio = btn.dataset.beneficio;
    const label = kind === 'marca' ? 'Envio da marca' : beneficioLabel(beneficio);
    const eligible = getEligibleItems(kind, beneficio);
    const pending = getPendingEligibleItems(kind, beneficio);

    if (!eligible.length) return;

    if (!pending.length) {
      alert(`Todos os ${eligible.length} patrocinador(es) elegíveis já estão marcados para ${label}.`);
      return;
    }

    const msg = `Marcar ${label} para todos os ${eligible.length} patrocinador(es) elegíveis?`;
    if (!confirm(msg)) return;

    bulkUpdating = true;
    renderTable();

    const errors = [];
    for (const item of pending) {
      const saveKey =
        kind === 'marca' ? `${item.arrecadacaoId}:marca` : `${item.arrecadacaoId}:${beneficio}`;
      saving.add(saveKey);
      try {
        const payload =
          kind === 'marca' ? { envioMarca: true } : { beneficio, concluido: true };
        const updated = await patchProducaoEntrega(item.arrecadacaoId, payload);
        updateItemFromResponse(updated);
      } catch (err) {
        errors.push(
          `${item.participanteNome || `#${item.arrecadacaoId}`}: ${err.message || 'Erro ao salvar'}`,
        );
      } finally {
        saving.delete(saveKey);
      }
    }

    bulkUpdating = false;
    renderTable();

    if (errors.length) {
      alert(`Alguns itens não foram salvos:\n${errors.slice(0, 6).join('\n')}`);
    }
  }

  async function handleIngressosCortesia(input) {
    if (bulkUpdating) return;

    const arrecadacaoId = Number(input.dataset.id);
    const saveKey = `${arrecadacaoId}:ingressos`;
    if (saving.has(saveKey)) return;

    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item) return;

    const raw = input.value.trim();
    const parsed = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      input.value = String(item.ingressosCortesia ?? 0);
      return;
    }
    const next = Math.floor(parsed);
    const current = item.ingressosCortesia ?? 0;
    if (next === current) {
      input.value = String(current);
      return;
    }

    saving.add(saveKey);
    input.disabled = true;
    const previous = current;

    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { ingressosCortesia: next });
      updateItemFromResponse(updated);
      saving.delete(saveKey);
      renderTable();
    } catch (err) {
      input.value = String(previous);
      alert(err.message || 'Não foi possível salvar.');
      input.disabled = false;
      saving.delete(saveKey);
    }
  }

  async function handleToggle(input) {
    if (bulkUpdating) {
      input.checked = !input.checked;
      return;
    }
    const arrecadacaoId = Number(input.dataset.id);
    const kind = input.dataset.kind;
    const beneficio = input.dataset.beneficio;
    const saveKey = kind === 'marca' ? `${arrecadacaoId}:marca` : `${arrecadacaoId}:${beneficio}`;

    if (saving.has(saveKey)) {
      input.checked = !input.checked;
      return;
    }

    saving.add(saveKey);
    input.disabled = true;
    const previous = input.checked;

    try {
      const payload =
        kind === 'marca'
          ? { envioMarca: input.checked }
          : { beneficio, concluido: input.checked };
      const updated = await patchProducaoEntrega(arrecadacaoId, payload);
      updateItemFromResponse(updated);
      saving.delete(saveKey);
      renderTable();
    } catch (err) {
      input.checked = !previous;
      alert(err.message || 'Não foi possível salvar.');
      input.disabled = false;
      saving.delete(saveKey);
    }
  }

  async function loadEntregas() {
    const data = await fetchProducaoEntregas();
    items = data.items || [];
    beneficiosDef = data.beneficiosDef || [];
    beneficiosColunas = data.beneficiosColunas || [];
    renderHeader();
    renderFilterPlanos();
    renderTable();
  }

  function onFiltersChange() {
    persistFilters();
    renderTable();
  }

  els.sort?.addEventListener('change', onFiltersChange);
  els.filterShow?.addEventListener('change', onFiltersChange);
  els.filterPlano?.addEventListener('change', onFiltersChange);

  return { loadEntregas };
}
