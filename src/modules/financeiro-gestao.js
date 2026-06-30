import { fetchFinanceiroPainel } from '../lib/api.js';
import { escapeHtml, fmtMoney } from '../lib/format.js';

function cellMoney(val) {
  return fmtMoney(val);
}

let financeiroGestaoInstance = null;

export function initFinanceiroGestaoModule() {
  if (financeiroGestaoInstance) return financeiroGestaoInstance;

  const els = {
    painelLoading: document.getElementById('financeiro-painel-loading'),
    painelBody: document.getElementById('financeiro-painel-body'),
    linkContas: document.getElementById('financeiro-link-contas'),
  };

  let painel = null;
  let loading = false;

  function renderPainel() {
    if (!els.painelBody) return;

    const custos = painel?.custos?.totais || { previsto: 0, realizado: 0, falta: 0 };
    const ent = painel?.entradas?.total || { previsto: 0, realizado: 0, falta: 0 };
    const r = painel?.resultado || {
      saldoPrevisto: ent.previsto - custos.previsto,
      faltaArrecadar: Math.max(0, custos.previsto - ent.previsto),
    };
    const nItens = painel?.totalItens || 0;

    els.painelBody.innerHTML = `
      <div class="financeiro-kpis financeiro-kpis--hero">
        <div class="financeiro-kpi financeiro-kpi--hero">
          <span class="financeiro-kpi-label">Custo total previsto</span>
          <strong class="financeiro-kpi-val">${cellMoney(custos.previsto)}</strong>
          <span class="financeiro-kpi-sub">${nItens} conta(s) a pagar ativa(s)</span>
        </div>
        <div class="financeiro-kpi">
          <span class="financeiro-kpi-label">Custo realizado</span>
          <strong class="financeiro-kpi-val fin-val--pos">${cellMoney(custos.realizado)}</strong>
          <span class="financeiro-kpi-sub">falta pagar ${cellMoney(custos.falta)}</span>
        </div>
        <div class="financeiro-kpi">
          <span class="financeiro-kpi-label">Entradas previstas</span>
          <strong class="financeiro-kpi-val">${cellMoney(ent.previsto)}</strong>
          <span class="financeiro-kpi-sub">espaços + patrocínios (arrecadação)</span>
        </div>
        <div class="financeiro-kpi ${r.faltaArrecadar > 0 ? 'financeiro-kpi--warn' : ''}">
          <span class="financeiro-kpi-label">Falta arrecadar</span>
          <strong class="financeiro-kpi-val">${cellMoney(r.faltaArrecadar)}</strong>
          <span class="financeiro-kpi-sub">para cobrir o custo previsto</span>
        </div>
      </div>
      ${
        painel?.custos?.categorias?.length
          ? `
      <div class="financeiro-cat-chips">
        ${painel.custos.categorias
          .map(
            (c) =>
              `<span class="financeiro-cat-chip"><strong>${escapeHtml(c.nome)}</strong> ${cellMoney(c.previsto)}</span>`,
          )
          .join('')}
      </div>`
          : ''
      }
      <p class="financeiro-gestao-hint">
        Os custos do evento são lançados em <a href="#financeiro-contas-pagar" id="financeiro-link-contas-inline">Contas a pagar</a>.
        Cada conta exige categoria e plano de contas; fornecedor é opcional.
      </p>
    `;

    els.linkContas = document.getElementById('financeiro-link-contas-inline');
    els.linkContas?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = 'financeiro-contas-pagar';
    });
  }

  async function loadFinanceiroGestao() {
    if (loading) return;
    loading = true;
    els.painelLoading?.classList.remove('hidden');

    try {
      const res = await fetchFinanceiroPainel();
      painel = res?.painel || null;
      renderPainel();
    } catch (err) {
      if (els.painelBody) {
        els.painelBody.innerHTML = `<p class="form-errors">${escapeHtml(err.message || 'Falha ao carregar.')}</p>`;
      }
    } finally {
      loading = false;
      els.painelLoading?.classList.add('hidden');
    }
  }

  els.linkContas?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = 'financeiro-contas-pagar';
  });

  financeiroGestaoInstance = { loadFinanceiroGestao };
  return financeiroGestaoInstance;
}
