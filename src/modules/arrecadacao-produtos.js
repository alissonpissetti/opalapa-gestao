import {
  fetchArrecadacaoProdutos,
  createArrecadacaoProduto,
  updateArrecadacaoProduto,
  deleteArrecadacaoProduto,
  duplicateArrecadacaoProduto,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, formatValorInput, maskValorInput, parseValor } from '../lib/format.js';

function statusBadge(ativo) {
  return ativo
    ? '<span class="fin-catalog-badge fin-catalog-badge--ativo">Ativo</span>'
    : '<span class="fin-catalog-badge fin-catalog-badge--inativo">Inativo</span>';
}

function countBeneficiosAtivos(beneficios = {}) {
  return Object.values(beneficios).filter(Boolean).length;
}

let produtosModuleInstance = null;

export function initArrecadacaoProdutosModule({ onChanged } = {}) {
  if (produtosModuleInstance) return produtosModuleInstance;

  const els = {
    summary: document.getElementById('arr-produtos-summary'),
    table: document.getElementById('arr-produtos-table'),
    btnNew: document.getElementById('btn-arr-produto-new'),
    editModalBg: document.getElementById('arr-produto-edit-modal-bg'),
    editTitle: document.getElementById('arr-produto-edit-title'),
    editErrors: document.getElementById('arr-produto-edit-errors'),
    fieldNome: document.getElementById('arr-produto-edit-nome'),
    fieldOrdem: document.getElementById('arr-produto-edit-ordem'),
    fieldDescricao: document.getElementById('arr-produto-edit-descricao'),
    fieldValor: document.getElementById('arr-produto-edit-valor'),
    fieldEspacos: document.getElementById('arr-produto-edit-espacos'),
    fieldBeneficios: document.getElementById('arr-produto-edit-beneficios'),
    fieldAtivo: document.getElementById('arr-produto-edit-ativo'),
    btnEditCancel: document.getElementById('arr-produto-edit-cancel'),
    btnEditDelete: document.getElementById('arr-produto-edit-delete'),
    btnEditSave: document.getElementById('arr-produto-edit-save'),
  };

  let produtos = [];
  let beneficiosDef = [];
  let beneficiosUniversais = [];
  let espacosTipos = [];
  let editId = null;
  let loading = false;

  function showFormErrors(msg) {
    if (!els.editErrors) return;
    if (!msg) {
      els.editErrors.classList.add('hidden');
      els.editErrors.textContent = '';
      return;
    }
    els.editErrors.textContent = msg;
    els.editErrors.classList.remove('hidden');
  }

  function renderCheckgrid(container, items, selectedMap, namePrefix, { lockedKeys = new Set() } = {}) {
    if (!container) return;
    container.innerHTML = items
      .map((item) => {
        const key = item.key || item;
        const label = item.label || item;
        const isUniversal = lockedKeys.has(key) || item.universal;
        const limiteHint = item.limiteHint
          ? `<span class="arr-produto-check-hint">${escapeHtml(item.limiteHint)}</span>`
          : '';
        const universalHint = isUniversal
          ? '<span class="arr-produto-check-hint">Incluso em todos os planos</span>'
          : '';
        const checked = isUniversal || selectedMap[key] ? ' checked' : '';
        const disabled = isUniversal ? ' disabled' : '';
        return `<label class="arr-produto-check${isUniversal ? ' arr-produto-check--universal' : ''}">
          <input type="checkbox" name="${namePrefix}-${escapeHtml(key)}" data-key="${escapeHtml(key)}"${checked}${disabled} />
          <span>${escapeHtml(label)}${limiteHint}${universalHint}</span>
        </label>`;
      })
      .join('');
  }

  function readCheckgrid(container) {
    const out = {};
    container?.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
      out[input.dataset.key] = input.checked;
    });
    for (const key of beneficiosUniversais) {
      out[key] = true;
    }
    return out;
  }

  function readEspacosSelected(container) {
    const out = [];
    container?.querySelectorAll('input[type="checkbox"][data-key]:checked').forEach((input) => {
      out.push(input.dataset.key);
    });
    return out;
  }

  function renderTable() {
    if (!els.table) return;
    if (!produtos.length) {
      els.table.innerHTML =
        '<tr><td colspan="7" class="cell-empty">Nenhum plano cadastrado.</td></tr>';
      return;
    }

    els.table.innerHTML = produtos
      .map((p) => {
        const espacos = p.espacosTipos?.length ? p.espacosTipos.join(', ') : '—';
        const benefCount = countBeneficiosAtivos(p.beneficios);
        const valorCell =
          p.valor != null && p.valor > 0
            ? `<span class="cell-money">${fmtMoney(p.valor)}</span>`
            : '<span class="cell-muted">—</span>';
        return `
      <tr data-id="${p.id}" class="${p.ativo ? '' : 'fin-catalog-row--inativo'}">
        <td>
          <strong>${escapeHtml(p.nome)}</strong>
          ${p.descricao ? `<div class="cell-muted">${escapeHtml(p.descricao)}</div>` : ''}
        </td>
        <td>${valorCell}</td>
        <td>${escapeHtml(espacos)}</td>
        <td>${benefCount} benefício(s)</td>
        <td>${p.usoLeads || 0}</td>
        <td>${statusBadge(p.ativo)}</td>
        <td class="row-actions arr-produtos-actions">
          <button type="button" class="tbtn" data-action="edit">Editar</button>
          <button type="button" class="tbtn" data-action="duplicate">Duplicar</button>
          <button type="button" class="tbtn" data-action="toggle">${p.ativo ? 'Inativar' : 'Reativar'}</button>
          <button type="button" class="tbtn danger-text" data-action="delete"${p.usoLeads ? ' disabled title="Há patrocinadores vinculados"' : ''}>Excluir</button>
        </td>
      </tr>`;
      })
      .join('');

    els.table.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tr = btn.closest('tr[data-id]');
        if (!tr) return;
        const id = Number(tr.dataset.id);
        const item = produtos.find((p) => p.id === id);
        if (!item) return;
        const action = btn.dataset.action;
        if (action === 'edit') openEditModal(item);
        else if (action === 'duplicate') void duplicateItem(item);
        else if (action === 'toggle') void toggleAtivo(item);
        else if (action === 'delete') void removeItem(item);
      });
    });
  }

  function renderSummary() {
    if (!els.summary) return;
    const ativos = produtos.filter((p) => p.ativo).length;
    els.summary.textContent = `${ativos} plano(s) ativo(s) · ${produtos.length} cadastrado(s)`;
  }

  function renderAll() {
    renderTable();
    renderSummary();
  }

  function openEditModal(item = null) {
    editId = item?.id ?? null;
    showFormErrors(null);

    if (els.editTitle) {
      els.editTitle.textContent = editId ? `Editar plano — ${item.nome}` : 'Novo plano de patrocínio';
    }
    if (els.fieldNome) els.fieldNome.value = item?.nome || '';
    if (els.fieldOrdem) els.fieldOrdem.value = item?.ordem != null ? String(item.ordem) : '';
    if (els.fieldDescricao) els.fieldDescricao.value = item?.descricao || '';
    if (els.fieldValor) {
      els.fieldValor.value =
        item?.valor != null && item.valor > 0 ? formatValorInput(item.valor) : '';
    }
    if (els.fieldAtivo) els.fieldAtivo.checked = item ? Boolean(item.ativo) : true;

    renderCheckgrid(
      els.fieldEspacos,
      espacosTipos.map((t) => ({ key: t, label: t })),
      Object.fromEntries((item?.espacosTipos || []).map((t) => [t, true])),
      'espaco',
    );
    const beneficiosSelected = { ...(item?.beneficios || {}) };
    for (const key of beneficiosUniversais) {
      beneficiosSelected[key] = true;
    }
    renderCheckgrid(els.fieldBeneficios, beneficiosDef, beneficiosSelected, 'beneficio', {
      lockedKeys: new Set(beneficiosUniversais),
    });

    els.btnEditDelete?.classList.toggle('hidden', !editId);
    els.editModalBg?.classList.add('open');
    els.fieldNome?.focus();
  }

  function closeEditModal() {
    editId = null;
    showFormErrors(null);
    els.editModalBg?.classList.remove('open');
  }

  async function loadProdutos() {
    if (loading) return produtos;
    loading = true;
    try {
      const data = await fetchArrecadacaoProdutos({ gestao: true });
      produtos = data?.produtos || [];
      beneficiosDef = data?.beneficiosDef || [];
      beneficiosUniversais = data?.beneficiosUniversais || [];
      espacosTipos = data?.espacosTipos || [];
      renderAll();
      return produtos;
    } catch (err) {
      if (els.summary) els.summary.textContent = err.message || 'Falha ao carregar.';
      return produtos;
    } finally {
      loading = false;
    }
  }

  async function saveEditModal() {
    const nome = els.fieldNome?.value?.trim() || '';
    if (!nome) {
      showFormErrors('Informe o nome do plano.');
      els.fieldNome?.focus();
      return;
    }

    const valorRaw = els.fieldValor?.value?.trim() || '';
    const valorParsed = valorRaw ? parseValor(valorRaw) : null;

    const payload = {
      nome,
      descricao: els.fieldDescricao?.value?.trim() || '',
      valor: valorParsed ?? 0,
      ordem: els.fieldOrdem?.value !== '' ? Number(els.fieldOrdem.value) : undefined,
      ativo: Boolean(els.fieldAtivo?.checked),
      beneficios: readCheckgrid(els.fieldBeneficios),
      espacosTipos: readEspacosSelected(els.fieldEspacos),
    };

    showFormErrors(null);
    els.btnEditSave.disabled = true;
    try {
      if (editId) {
        await updateArrecadacaoProduto(editId, payload);
      } else {
        await createArrecadacaoProduto(payload);
      }
      closeEditModal();
      await loadProdutos();
      onChanged?.();
    } catch (err) {
      showFormErrors(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnEditSave.disabled = false;
    }
  }

  async function duplicateItem(item) {
    try {
      const { produto } = await duplicateArrecadacaoProduto(item.id);
      await loadProdutos();
      onChanged?.();
      if (produto) {
        const fresh = produtos.find((p) => p.id === produto.id) || produto;
        openEditModal(fresh);
      }
    } catch (err) {
      alert(err.message || 'Não foi possível duplicar.');
    }
  }

  async function toggleAtivo(item) {
    const next = !item.ativo;
    const verb = next ? 'reativar' : 'inativar';
    if (!window.confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} o plano "${item.nome}"?`)) return;
    try {
      await updateArrecadacaoProduto(item.id, { ativo: next });
      await loadProdutos();
      onChanged?.();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeItem(item) {
    if (!window.confirm(`Excluir o plano "${item.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteArrecadacaoProduto(item.id);
      await loadProdutos();
      onChanged?.();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeFromEditModal() {
    if (!editId) return;
    const item = produtos.find((p) => p.id === editId);
    if (!item) return;
    await removeItem(item);
    closeEditModal();
  }

  els.fieldValor?.addEventListener('input', (e) => maskValorInput(e.target));

  els.btnNew?.addEventListener('click', () => openEditModal());
  els.btnEditCancel?.addEventListener('click', closeEditModal);
  els.btnEditSave?.addEventListener('click', () => void saveEditModal());
  els.btnEditDelete?.addEventListener('click', () => void removeFromEditModal());
  els.editModalBg?.addEventListener('click', (e) => {
    if (e.target === els.editModalBg) closeEditModal();
  });

  produtosModuleInstance = {
    loadProdutos,
    getProdutos: () => produtos,
    getBeneficiosDef: () => beneficiosDef,
    getBeneficiosUniversais: () => beneficiosUniversais,
    getEspacosTipos: () => espacosTipos,
  };

  return produtosModuleInstance;
}
