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
  let pending = 0;
  if (!item.envioIngressos) pending += 1;
  if (!item.envioMarca) pending += 1;
  const ativos = item.beneficiosAtivos || {};
  const concluidos = item.beneficiosConcluidos || {};
  for (const [key, active] of Object.entries(ativos)) {
    if (active && !concluidos[key]) pending += 1;
  }
  return pending;
}

function effectiveCamisetasCount(item) {
  if (!item) return 0;
  const camisetas = item.camisetasSolicitadas;
  if (camisetas != null && Number.isFinite(Number(camisetas))) {
    return Math.max(0, Math.floor(Number(camisetas)));
  }
  const ingressos = item.ingressosSolicitados ?? item.ingressosCortesia ?? 0;
  return Math.max(0, Math.floor(Number(ingressos) || 0));
}

function countTotalChecklist(item) {
  let total = 2;
  const ativos = item.beneficiosAtivos || {};
  for (const active of Object.values(ativos)) {
    if (active) total += 1;
  }
  return total;
}

export function initProducaoEntregasModule({ onOpenLead, onEntregaCamisetasUpdated } = {}) {
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
  let camisetaTamanhos = [];
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
    if (kind === 'marca' || kind === 'envioIngressos') return visible;
    return visible.filter((item) => item.beneficiosAtivos?.[beneficioKey]);
  }

  function getPendingEligibleItems(kind, beneficioKey) {
    const eligible = getEligibleItems(kind, beneficioKey);
    if (kind === 'marca') return eligible.filter((item) => !item.envioMarca);
    if (kind === 'envioIngressos') return eligible.filter((item) => !item.envioIngressos);
    return eligible.filter((item) => !item.beneficiosConcluidos?.[beneficioKey]);
  }

  function findEntregaItemIndex(arrecadacaoId, participanteId) {
    const aid = Number(arrecadacaoId);
    if (Number.isFinite(aid)) {
      const byLead = items.findIndex((i) => Number(i.arrecadacaoId) === aid);
      if (byLead >= 0) return byLead;
    }
    const pid = Number(participanteId);
    if (Number.isFinite(pid)) {
      return items.findIndex((i) => Number(i.participanteId) === pid);
    }
    return -1;
  }

  function updateItemFromResponse(updated, localPatch = null) {
    const next = updated?.item;
    const idx = next
      ? findEntregaItemIndex(next.arrecadacaoId, next.participanteId)
      : localPatch
        ? findEntregaItemIndex(localPatch.arrecadacaoId, localPatch.participanteId)
        : -1;
    if (idx < 0) return;
    if (next) {
      items[idx] = { ...items[idx], ...next };
    } else if (localPatch) {
      items[idx] = { ...items[idx], ...localPatch };
    }
  }

  function renderSelectAllHeader(label, kind, beneficioKey = '') {
    const dataAttrs =
      kind === 'marca'
        ? 'data-kind="marca"'
        : kind === 'envioIngressos'
          ? 'data-kind="envioIngressos"'
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
        <th class="entregas-th-ingressos">Qtd. ingressos</th>
        <th class="entregas-th-envio-ingressos entregas-th-check">${renderSelectAllHeader('Envio de ingressos', 'envioIngressos')}</th>
        <th class="entregas-th-camisetas-qty">Qtd. camisetas</th>
        <th class="entregas-th-camisetas-tamanhos">Tamanhos</th>
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

  function renderIngressosCell(item) {
    const disabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:ingressos`);
    const value = item.ingressosSolicitados ?? item.ingressosCortesia ?? 0;
    const padrao = item.ingressosPadrao ?? 1;
    const meta = item.ingressosPersonalizado
      ? `<button type="button" class="entregas-ingressos-reset" data-id="${item.arrecadacaoId}"
          title="Usar padrão do plano (${padrao})" aria-label="Restaurar padrão do plano">↺</button>`
      : `<span class="entregas-ingressos-hint" title="Padrão do plano">padrão ${padrao}</span>`;
    return `
      <td class="entregas-cell-ingressos">
        <div class="entregas-ingressos-wrap">
          <input type="number" class="entregas-ingressos-input" data-kind="ingressos" data-id="${item.arrecadacaoId}"
            min="0" step="1" inputmode="numeric" placeholder="${padrao}" value="${value}"
            aria-label="Ingressos solicitados" ${disabled ? 'disabled' : ''} />
          ${meta}
        </div>
      </td>`;
  }

  function renderCamisetasQtyCell(item) {
    const count = effectiveCamisetasCount(item);
    const qtyDisabled =
      bulkUpdating || saving.has(`${item.arrecadacaoId}:camisetas-qty`) || saving.has(`${item.arrecadacaoId}:camisetas`);
    const meta = item.camisetasPersonalizado
      ? `<button type="button" class="entregas-camisetas-reset" data-id="${item.arrecadacaoId}"
          title="Voltar a acompanhar a quantidade de ingressos" aria-label="Vincular quantidade à de ingressos">↺</button>`
      : `<span class="entregas-camisetas-hint" title="Quantidade igual à de ingressos">= ingressos</span>`;
    return `
      <td class="entregas-cell-camisetas-qty">
        <div class="entregas-camisetas-qty-wrap">
          <input type="number" class="entregas-camisetas-qty-input" data-kind="camisetas-qty" data-id="${item.arrecadacaoId}"
            min="0" step="1" inputmode="numeric" value="${count}"
            aria-label="Quantidade de camisetas" ${qtyDisabled ? 'disabled' : ''} />
          ${meta}
        </div>
      </td>`;
  }

  function renderCamisetasTamanhosCell(item) {
    const count = effectiveCamisetasCount(item);
    if (!count) {
      return `<td class="entregas-cell-camisetas-tamanhos"><span class="cell-empty">—</span></td>`;
    }
    const sizesDisabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:camisetas`);
    const sizes = item.camisetasTamanhos || [];
    const optionHtml = (selected) => {
      const opts = ['<option value="">—</option>'];
      for (const t of camisetaTamanhos) {
        const sel = selected === t ? ' selected' : '';
        opts.push(`<option value="${escapeHtml(t)}"${sel}>${escapeHtml(t)}</option>`);
      }
      return opts.join('');
    };
    const rows = Array.from({ length: count }, (_, idx) => {
      const selected = sizes[idx] || '';
      return `<label class="entregas-camiseta-row">
        <span class="entregas-camiseta-idx">${idx + 1}</span>
        <select class="entregas-camiseta-select" data-id="${item.arrecadacaoId}" data-index="${idx}"
          aria-label="Tamanho da camiseta ${idx + 1}" ${sizesDisabled ? 'disabled' : ''}>
          ${optionHtml(selected)}
        </select>
      </label>`;
    }).join('');
    return `
      <td class="entregas-cell-camisetas-tamanhos">
        <div class="entregas-camisetas-list">${rows}</div>
      </td>`;
  }

  function renderEnvioIngressosCell(item) {
    const disabled = bulkUpdating || saving.has(`${item.arrecadacaoId}:envioIngressos`);
    return `
      <td class="entregas-cell-envio-ingressos entrega-cell-check">
        <input type="checkbox" data-kind="envioIngressos" data-id="${item.arrecadacaoId}"
          aria-label="Envio de ingressos"
          ${item.envioIngressos ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
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
    const colCount = 9 + beneficiosColunas.length;

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
            ${renderIngressosCell(item)}
            ${renderEnvioIngressosCell(item)}
            ${renderCamisetasQtyCell(item)}
            ${renderCamisetasTamanhosCell(item)}
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
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', () => handleToggle(input));
    });

    els.table.querySelectorAll('.entregas-ingressos-input').forEach((input) => {
      input.addEventListener('change', () => void handleIngressosSolicitados(input));
    });

    els.table.querySelectorAll('.entregas-ingressos-reset').forEach((btn) => {
      btn.addEventListener('click', () => void handleIngressosPadrao(btn));
    });

    els.table.querySelectorAll('.entregas-camisetas-qty-input').forEach((input) => {
      input.addEventListener('change', () => void handleCamisetasSolicitadas(input));
    });

    els.table.querySelectorAll('.entregas-camisetas-reset').forEach((btn) => {
      btn.addEventListener('click', () => void handleCamisetasPadrao(btn));
    });

    els.table.querySelectorAll('.entregas-camiseta-select').forEach((select) => {
      select.addEventListener('change', () => void handleCamisetasChange(select));
    });

    els.thead?.querySelectorAll('.entregas-select-all').forEach((btn) => {
      btn.disabled = bulkUpdating;
    });
  }

  async function handleSelectAll(btn) {
    if (bulkUpdating) return;

    const kind = btn.dataset.kind;
    const beneficio = btn.dataset.beneficio;
    const label =
      kind === 'marca'
        ? 'Envio da marca'
        : kind === 'envioIngressos'
          ? 'Envio de ingressos'
          : beneficioLabel(beneficio);
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
        kind === 'marca'
          ? `${item.arrecadacaoId}:marca`
          : kind === 'envioIngressos'
            ? `${item.arrecadacaoId}:envioIngressos`
            : `${item.arrecadacaoId}:${beneficio}`;
      saving.add(saveKey);
      try {
        const payload =
          kind === 'marca'
            ? { envioMarca: true }
            : kind === 'envioIngressos'
              ? { envioIngressos: true }
              : { beneficio, concluido: true };
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

  async function handleIngressosSolicitados(input) {
    if (bulkUpdating) return;

    const arrecadacaoId = Number(input.dataset.id);
    const saveKey = `${arrecadacaoId}:ingressos`;
    if (saving.has(saveKey)) return;

    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item) return;

    const raw = input.value.trim();
    const parsed = raw === '' ? item.ingressosPadrao ?? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      input.value = String(item.ingressosSolicitados ?? 0);
      return;
    }
    const next = Math.floor(parsed);
    const current = item.ingressosSolicitados ?? 0;
    if (next === current) {
      input.value = String(current);
      return;
    }

    saving.add(saveKey);
    input.disabled = true;
    const previous = current;

    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { ingressosSolicitados: next });
      updateItemFromResponse(updated);
      onEntregaCamisetasUpdated?.();
      saving.delete(saveKey);
      renderTable();
    } catch (err) {
      input.value = String(previous);
      alert(err.message || 'Não foi possível salvar.');
      input.disabled = false;
      saving.delete(saveKey);
    }
  }

  async function handleCamisetasSolicitadas(input) {
    if (bulkUpdating) return;

    const arrecadacaoId = Number(input.dataset.id);
    const saveKey = `${arrecadacaoId}:camisetas-qty`;
    if (saving.has(saveKey)) return;

    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item) return;

    const raw = input.value.trim();
    const parsed = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      input.value = String(effectiveCamisetasCount(item));
      return;
    }
    const next = Math.floor(parsed);
    const current = effectiveCamisetasCount(item);
    if (next === current) {
      input.value = String(current);
      return;
    }

    saving.add(saveKey);
    input.disabled = true;
    const previous = current;

    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { camisetasSolicitadas: next });
      updateItemFromResponse(updated);
      onEntregaCamisetasUpdated?.();
      saving.delete(saveKey);
      renderTable();
    } catch (err) {
      input.value = String(previous);
      alert(err.message || 'Não foi possível salvar.');
      input.disabled = false;
      saving.delete(saveKey);
    }
  }

  async function handleCamisetasPadrao(btn) {
    if (bulkUpdating) return;
    const arrecadacaoId = Number(btn.dataset.id);
    const saveKey = `${arrecadacaoId}:camisetas-qty`;
    if (saving.has(saveKey)) return;
    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item?.camisetasPersonalizado) return;

    saving.add(saveKey);
    btn.disabled = true;
    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { camisetasUsarPadrao: true });
      updateItemFromResponse(updated);
      onEntregaCamisetasUpdated?.();
      renderTable();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      saving.delete(saveKey);
    }
  }

  async function handleIngressosPadrao(btn) {
    if (bulkUpdating) return;
    const arrecadacaoId = Number(btn.dataset.id);
    const saveKey = `${arrecadacaoId}:ingressos`;
    if (saving.has(saveKey)) return;
    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item?.ingressosPersonalizado) return;

    saving.add(saveKey);
    btn.disabled = true;
    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { ingressosUsarPadrao: true });
      updateItemFromResponse(updated);
      onEntregaCamisetasUpdated?.();
      renderTable();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      saving.delete(saveKey);
    }
  }

  function readCamisetasFromRow(arrecadacaoId) {
    const selects = els.table?.querySelectorAll(
      `.entregas-camiseta-select[data-id="${arrecadacaoId}"]`,
    );
    if (!selects?.length) return [];
    return [...selects].map((el) => el.value.trim());
  }

  async function handleCamisetasChange(select) {
    if (bulkUpdating) return;
    const arrecadacaoId = Number(select.dataset.id);
    const saveKey = `${arrecadacaoId}:camisetas`;
    if (saving.has(saveKey)) return;

    const item = items.find((i) => i.arrecadacaoId === arrecadacaoId);
    if (!item) return;

    const next = readCamisetasFromRow(arrecadacaoId);
    const prev = item.camisetasTamanhos || [];
    if (next.join('|') === prev.join('|')) return;

    saving.add(saveKey);
    renderTable();
    try {
      const updated = await patchProducaoEntrega(arrecadacaoId, { camisetasTamanhos: next });
      updateItemFromResponse(updated);
      onEntregaCamisetasUpdated?.();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      saving.delete(saveKey);
      renderTable();
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
    const saveKey =
      kind === 'marca'
        ? `${arrecadacaoId}:marca`
        : kind === 'envioIngressos'
          ? `${arrecadacaoId}:envioIngressos`
          : `${arrecadacaoId}:${beneficio}`;

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
          : kind === 'envioIngressos'
            ? { envioIngressos: input.checked }
            : { beneficio, concluido: input.checked };
      const item = items.find((i) => Number(i.arrecadacaoId) === arrecadacaoId);
      const localPatch =
        kind === 'marca'
          ? { arrecadacaoId, participanteId: item?.participanteId, envioMarca: input.checked }
          : kind === 'envioIngressos'
            ? {
                arrecadacaoId,
                participanteId: item?.participanteId,
                envioIngressos: input.checked,
              }
            : null;
      const updated = await patchProducaoEntrega(arrecadacaoId, payload);
      updateItemFromResponse(updated, localPatch);
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
    camisetaTamanhos = data.camisetaTamanhos || ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', '3G'];
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
