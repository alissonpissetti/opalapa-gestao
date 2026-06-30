import {
  fetchFinanceiroPainel,
  patchSumarioArrecadacaoPrevisto,
  patchVendaHora,
  carregarModeloVendasHora,
  patchBebida,
  carregarModeloBebidas,
  patchFaturamentoPracaAlimentacao,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, formatValorInput, maskValorInput, parseValor } from '../lib/format.js';
import { BAR_CHART_COLORS, renderBarChart } from '../lib/bar-chart.js';
import { renderFinSwatch, renderPieChart, resolvePieSliceColors } from '../lib/pie-chart.js';

function custoCategoriaValor(c) {
  const custoTotal = Number(c.custoTotal) || 0;
  if (custoTotal > 0) return custoTotal;
  return Number(c.valorPrevisto) || 0;
}

function buildCustoPieSlices(categorias) {
  return categorias.map((c) => ({
    label: c.categoriaNome,
    value: custoCategoriaValor(c),
  }));
}

function buildArrecadacaoPieSlices(linhas) {
  return linhas.map((l) => ({
    label: l.nome,
    value: Number(l.previsto) || 0,
  }));
}

function cellMoney(val) {
  return fmtMoney(val);
}

function renderPrevistoCell(l) {
  if (l.previstoEditavel === false) {
    return `<span class="fin-val fin-sumario-previsto-readonly" title="Calculado automaticamente pelo sistema">${cellMoney(l.previsto)}</span><span class="fin-sumario-auto-hint">calculado automaticamente</span>`;
  }
  return `<input type="text" class="fin-inline-input fin-inline-money fin-sumario-previsto" data-chave="${escapeHtml(l.id)}" title="Valor previsto editável" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(l.previsto))}" />`;
}

function resolveSumarioGrupos(sumario) {
  const linhas = sumario?.linhas || [];
  const linhasPre = sumario.linhasPre?.length ? sumario.linhasPre : linhas.filter((l) => !l.posEvento);
  const linhasPos = sumario.linhasPos?.length ? sumario.linhasPos : linhas.filter((l) => l.posEvento);
  const sumTotais = (items) => {
    const previsto = items.reduce((s, l) => s + (Number(l.previsto) || 0), 0);
    const realizado = items.reduce((s, l) => s + (Number(l.realizado) || 0), 0);
    return { previsto, realizado, falta: Math.max(0, previsto - realizado) };
  };
  return {
    linhasPre,
    linhasPos,
    totaisPre: sumario.totaisPre || sumTotais(linhasPre),
    totaisPos: sumario.totaisPos || sumTotais(linhasPos),
    totais: sumario.totais || sumTotais(linhas),
  };
}

function renderSumarioLinha(l, colorIndex, arrecadacaoColors) {
  return `
              <tr data-sumario-chave="${escapeHtml(l.id)}">
                <td class="fin-custo-cat"><span class="fin-cat-with-swatch">${renderFinSwatch(arrecadacaoColors[colorIndex])}<span>${escapeHtml(l.nome)}</span></span></td>
                <td class="fin-col-money fin-col-previsto">${renderPrevistoCell(l)}</td>
                <td class="fin-col-money fin-col-realizado">${cellMoney(l.realizado)}</td>
              </tr>`;
}

function renderSumarioGrupo({ titulo, grupo, linhas, totais, colorById, arrecadacaoColors }) {
  if (!linhas.length) return '';
  const rows = linhas
    .map((l) => renderSumarioLinha(l, colorById.get(l.id) ?? 0, arrecadacaoColors))
    .join('');
  return `
            <tbody class="fin-sumario-grupo" data-sumario-grupo="${grupo}">
              <tr class="fin-sumario-grupo-head">
                <th colspan="3" scope="rowgroup">${escapeHtml(titulo)}</th>
              </tr>
              ${rows}
              <tr class="fin-sumario-subtotal" data-sumario-subtotal="${grupo}">
                <td>Subtotal</td>
                <td class="fin-col-money fin-col-previsto">${cellMoney(totais.previsto)}</td>
                <td class="fin-col-money fin-col-realizado">${cellMoney(totais.realizado)}</td>
              </tr>
            </tbody>`;
}

function renderSumarioArrecadacao(sumario) {
  if (!sumario?.linhas?.length) return '';

  const { linhasPre, linhasPos, totaisPre, totaisPos, totais } = resolveSumarioGrupos(sumario);
  const arrecadacaoSlices = buildArrecadacaoPieSlices(sumario.linhas);
  const { colorByIndex: arrecadacaoColors } = resolvePieSliceColors(arrecadacaoSlices);
  const colorById = new Map(sumario.linhas.map((l, i) => [l.id, i]));
  const pieArrecadacao = renderPieChart(arrecadacaoSlices, {
    title: 'Participação na arrecadação (previsto)',
    showLegend: false,
  });

  return `
      <section class="financeiro-arrecadacao" id="financeiro-sumario-arrecadacao" aria-label="Sumário de arrecadação">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Sumário de arrecadação</h2>
          <span class="financeiro-painel-lead">Previsto editável por categoria</span>
        </div>
        <div class="financeiro-chart-row">
        <div class="table-wrap">
          <table class="table-financeiro-custos table-financeiro-arrecadacao">
            <thead>
              <tr>
                <th>Categoria</th>
                <th class="fin-col-money">Previsto</th>
                <th class="fin-col-money fin-col-realizado">Realizado</th>
              </tr>
            </thead>
            ${renderSumarioGrupo({
              titulo: 'Arrecadação pré',
              grupo: 'pre',
              linhas: linhasPre,
              totais: totaisPre,
              colorById,
              arrecadacaoColors,
            })}
            ${renderSumarioGrupo({
              titulo: 'Arrecadação pós',
              grupo: 'pos',
              linhas: linhasPos,
              totais: totaisPos,
              colorById,
              arrecadacaoColors,
            })}
            <tfoot>
              <tr class="fin-custo-total" data-sumario-totais>
                <td>Total</td>
                <td class="fin-col-money fin-col-previsto-total">${cellMoney(totais.previsto)}</td>
                <td class="fin-col-money fin-col-realizado">${cellMoney(totais.realizado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="financeiro-pie-wrap" aria-label="Gráfico de participação na arrecadação">${pieArrecadacao}</div>
        </div>
      </section>`;
}

function renderVendaHoraQtyInput(item, field, value) {
  return `<input type="number" class="fin-inline-input fin-inline-qty fin-venda-hora-qty" data-id="${item.id}" data-field="${field}" step="1" min="0" inputmode="numeric" autocomplete="off" value="${escapeHtml(String(value ?? 0))}" />`;
}

function renderVendaHoraMoneyInput(item, value) {
  return `<input type="text" class="fin-inline-input fin-inline-money fin-venda-hora-valor" data-id="${item.id}" data-field="valorVenda" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(value))}" />`;
}

function renderVendasHora(vendasHora) {
  if (!vendasHora) return '';

  if (!vendasHora.temDados) {
    return `
      <section class="financeiro-vendas-hora" id="financeiro-vendas-hora" aria-label="Vendas na hora">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Vendas na hora</h2>
          <span class="financeiro-painel-lead">Cenário previsto versus realizado</span>
        </div>
        <p class="financeiro-vendas-hora-empty">Nenhum item de venda cadastrado para este evento.</p>
        <button type="button" class="btn btn-secondary" id="financeiro-vendas-hora-carregar">Carregar modelo vendas na hora</button>
      </section>`;
  }

  const totais = vendasHora.totais || { previsto: 0, realizado: 0 };

  return `
      <section class="financeiro-vendas-hora" id="financeiro-vendas-hora" aria-label="Vendas na hora">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Vendas na hora</h2>
          <span class="financeiro-painel-lead">Cenário previsto versus realizado</span>
        </div>
        <div class="table-wrap">
          <table class="table-financeiro-custos table-financeiro-vendas-hora">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Item</th>
                <th class="fin-col-qty">Previsto (qtd)</th>
                <th class="fin-col-qty">Realizado (qtd)</th>
                <th class="fin-col-money">R$ Venda</th>
                <th class="fin-col-money">Previsto (total)</th>
                <th class="fin-col-money fin-col-realizado">Realizado (total)</th>
              </tr>
            </thead>
            <tbody>
              ${vendasHora.itens
                .map(
                  (item) => `
              <tr data-venda-hora-id="${item.id}">
                <td class="fin-venda-cat">${escapeHtml(item.categoria)}</td>
                <td class="fin-venda-item">${escapeHtml(item.item)}</td>
                <td class="fin-col-qty">${renderVendaHoraQtyInput(item, 'previstoQtde', item.previstoQtde)}</td>
                <td class="fin-col-qty">${renderVendaHoraQtyInput(item, 'realizadoQtde', item.realizadoQtde)}</td>
                <td class="fin-col-money">${renderVendaHoraMoneyInput(item, item.valorVenda)}</td>
                <td class="fin-col-money fin-venda-previsto-total">${cellMoney(item.previstoTotal)}</td>
                <td class="fin-col-money fin-col-realizado fin-venda-realizado-total">${cellMoney(item.realizadoTotal)}</td>
              </tr>`,
                )
                .join('')}
            </tbody>
            <tfoot>
              <tr class="fin-custo-total" data-venda-hora-totais>
                <td colspan="2">TOTAL</td>
                <td class="fin-col-qty">—</td>
                <td class="fin-col-qty">—</td>
                <td class="fin-col-money">—</td>
                <td class="fin-col-money fin-venda-previsto-total-geral">${cellMoney(totais.previsto)}</td>
                <td class="fin-col-money fin-col-realizado fin-venda-realizado-total-geral">${cellMoney(totais.realizado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>`;
}

function renderBebidaQtyInput(item, field, value) {
  return `<input type="number" class="fin-inline-input fin-inline-qty fin-bebida-qty" data-id="${item.id}" data-field="${field}" step="1" min="0" inputmode="numeric" autocomplete="off" value="${escapeHtml(String(value ?? 0))}" />`;
}

function renderBebidaMoneyInput(item, field, value) {
  return `<input type="text" class="fin-inline-input fin-inline-money fin-bebida-money" data-id="${item.id}" data-field="${field}" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(value))}" />`;
}

function renderBebidas(bebidas) {
  if (!bebidas) return '';

  if (!bebidas.temDados) {
    return `
      <section class="financeiro-bebidas" id="financeiro-bebidas" aria-label="Arrecadação bebidas">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Arrecadação bebidas</h2>
          <span class="financeiro-painel-lead">Previsto versus realizado durante o evento</span>
        </div>
        <p class="financeiro-bebidas-empty">Nenhum item de bebida cadastrado para este evento.</p>
        <button type="button" class="btn btn-secondary" id="financeiro-bebidas-carregar">Carregar modelo arrecadação bebidas</button>
      </section>`;
  }

  const totais = bebidas.totais || {
    previstoReceita: 0,
    realizadoReceita: 0,
  };

  return `
      <section class="financeiro-bebidas" id="financeiro-bebidas" aria-label="Arrecadação bebidas">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Arrecadação bebidas</h2>
          <span class="financeiro-painel-lead">Previsto versus realizado durante o evento</span>
        </div>
        <div class="table-wrap">
          <table class="table-financeiro-custos table-financeiro-bebidas">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Item</th>
                <th class="fin-col-qty">Previsto (qtd)</th>
                <th class="fin-col-qty">Realizado (qtd)</th>
                <th class="fin-col-money">Valor unit.</th>
                <th class="fin-col-money">Previsto (receita)</th>
                <th class="fin-col-money fin-col-realizado">Realizado (receita)</th>
              </tr>
            </thead>
            <tbody>
              ${bebidas.itens
                .map(
                  (item) => `
              <tr data-bebida-id="${item.id}">
                <td class="fin-bebida-cat">${escapeHtml(item.categoria)}</td>
                <td class="fin-bebida-item">${escapeHtml(item.item)}</td>
                <td class="fin-col-qty">${renderBebidaQtyInput(item, 'previstoQtde', item.previstoQtde)}</td>
                <td class="fin-col-qty">${renderBebidaQtyInput(item, 'realizadoQtde', item.realizadoQtde)}</td>
                <td class="fin-col-money">${renderBebidaMoneyInput(item, 'valorUnit', item.valorUnit)}</td>
                <td class="fin-col-money fin-bebida-previsto-receita">${cellMoney(item.previstoReceita)}</td>
                <td class="fin-col-money fin-col-realizado fin-bebida-realizado-receita">${cellMoney(item.realizadoReceita)}</td>
              </tr>`,
                )
                .join('')}
            </tbody>
            <tfoot>
              <tr class="fin-custo-total" data-bebida-totais>
                <td colspan="2">TOTAL</td>
                <td class="fin-col-qty">—</td>
                <td class="fin-col-qty">—</td>
                <td class="fin-col-money">—</td>
                <td class="fin-col-money fin-bebida-previsto-receita-geral">${cellMoney(totais.previstoReceita)}</td>
                <td class="fin-col-money fin-col-realizado fin-bebida-realizado-receita-geral">${cellMoney(totais.realizadoReceita)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>`;
}

function resolveFaseComparativo(totais) {
  const t = totais || {};
  const pre = Number(t.pre ?? t.previstoPre) || 0;
  const pos = Number(t.pos ?? t.previstoPos) || 0;
  const realizado = Number(t.realizado ?? t.realizadoGeral) || 0;
  const realizadoPos = Number(t.realizadoPos) || 0;
  // Falta pré (planilha): previsto pré menos total pago em todas as fases.
  const faltaPreRaw = Number.isFinite(Number(t.faltaPre)) ? Number(t.faltaPre) : pre - realizado;
  // Falta pós: previsto pós menos pagamentos já feitos em contas da fase pós.
  const faltaPosRaw =
    Number.isFinite(Number(t.faltaPos)) ? Number(t.faltaPos) : Math.max(0, pos - realizadoPos);
  return { pre, pos, faltaPre: Math.max(0, faltaPreRaw), faltaPos: faltaPosRaw };
}

/** Métricas para comparar custos pendentes (contas a pagar) × sumário de arrecadação.
 *  Pré: faltaPre vs arrecadacaoPrevisto — gap = faltaPre − arrecadacaoPrevisto.
 *  Pós: faltaPos vs arrecadacaoRealizado — gap = faltaPos − arrecadacaoRealizado. */
function resolveCenariosPrePos(totaisContasPagar, sumarioArrecadacao) {
  const { pre, pos, faltaPre, faltaPos } = resolveFaseComparativo(totaisContasPagar);
  const grupos = resolveSumarioGrupos(sumarioArrecadacao || {});
  const arr = sumarioArrecadacao?.totais || {};
  const arrecadacaoPrevisto = Number(grupos.totaisPre.previsto) || 0;
  const arrecadacaoRealizado = Number(grupos.totaisPos.realizado) || 0;
  const faltaArrecadarSumario =
    Number.isFinite(Number(arr.falta)) && arr.falta != null
      ? Math.max(0, Number(arr.falta))
      : Math.max(0, (Number(grupos.totais.previsto) || 0) - (Number(grupos.totais.realizado) || 0));
  return {
    pre,
    pos,
    faltaPre,
    faltaPos,
    arrecadacaoPrevisto,
    arrecadacaoRealizado,
    faltaArrecadarSumario,
  };
}

function renderCenarioGapNote(gap, { positivo, coberto }) {
  if (gap > 0) {
    return `<p class="financeiro-fase-chart-note financeiro-fase-chart-note--warn">${positivo} <strong>${cellMoney(gap)}</strong></p>`;
  }
  if (gap < 0) {
    return `<p class="financeiro-fase-chart-note financeiro-fase-chart-note--ok">${coberto} <strong>${cellMoney(Math.abs(gap))}</strong></p>`;
  }
  return `<p class="financeiro-fase-chart-note">Valores equivalentes — custo pendente e arrecadação se equilibram.</p>`;
}

function renderFaseComparativoCharts(totaisContasPagar, sumarioArrecadacao) {
  const {
    pre,
    pos,
    faltaPre,
    faltaPos,
    arrecadacaoPrevisto,
    arrecadacaoRealizado,
    faltaArrecadarSumario,
  } = resolveCenariosPrePos(totaisContasPagar, sumarioArrecadacao);

  const temPre = faltaPre > 0 || arrecadacaoPrevisto > 0 || pre > 0;
  const temPos = faltaPos > 0 || arrecadacaoRealizado > 0 || faltaArrecadarSumario > 0 || pos > 0;
  if (!temPre && !temPos) return '';

  const gapPre = faltaPre - arrecadacaoPrevisto;
  const gapPos = faltaPos - arrecadacaoRealizado;

  const preChart = temPre
    ? renderBarChart(
        [
          { label: 'Falta pré', value: faltaPre, color: BAR_CHART_COLORS.falta },
          {
            label: 'Previsto arrecadação',
            value: arrecadacaoPrevisto,
            color: BAR_CHART_COLORS.previsto,
          },
        ],
        { title: 'Pré-evento: custos × arrecadação', width: 240, height: 156 },
      )
    : '';

  const posChart = temPos
    ? renderBarChart(
        [
          { label: 'Falta pós', value: faltaPos, color: BAR_CHART_COLORS.falta },
          {
            label: 'Realizado arrecadação',
            value: arrecadacaoRealizado,
            color: BAR_CHART_COLORS.realizado,
          },
        ],
        { title: 'Pós-evento: custos × arrecadação', width: 240, height: 156 },
      )
    : '';

  const preNote = temPre
    ? `<p class="financeiro-fase-chart-note financeiro-fase-chart-note--desc">Quanto falta pagar na fase pré vs arrecadação prevista no sumário.</p>${renderCenarioGapNote(gapPre, {
        positivo: 'Gap (falta pré − previsto arrecadação): ainda faltam',
        coberto: 'Previsto arrecadação supera o pré pendente em',
      })}`
    : '';

  const posNote = temPos
    ? `<p class="financeiro-fase-chart-note financeiro-fase-chart-note--desc">Quanto falta pagar na fase pós vs arrecadação já realizada no sumário.</p>${renderCenarioGapNote(gapPos, {
        positivo: 'Gap (falta pós − realizado arrecadação): ainda faltam',
        coberto: 'Realizado arrecadação supera o pós pendente em',
      })}`
    : '';

  return `
      <section class="financeiro-fase-charts" aria-label="Comparativo pré e pós-evento com arrecadação">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Cenários pré e pós-evento</h2>
          <span class="financeiro-painel-lead">Custo pendente por fase versus sumário de arrecadação (previsto no pré, realizado no pós)</span>
        </div>
        <div class="financeiro-fase-charts-grid">
          ${temPre ? `<div class="financeiro-fase-chart-card">${preChart}${preNote}</div>` : ''}
          ${temPos ? `<div class="financeiro-fase-chart-card">${posChart}${posNote}</div>` : ''}
        </div>
      </section>`;
}

function cellMoneySigned(val) {
  const n = Number(val) || 0;
  const cls = n < 0 ? ' fin-val--neg' : '';
  return `<span class="fin-val${cls}">${cellMoney(n)}</span>`;
}

function cellResultadoVal(val, { signed = false, aporte = false } = {}) {
  if (val == null) return '—';
  const n = Number(val) || 0;
  if (aporte && n > 0) {
    return `<span class="fin-val fin-val--aporte">${cellMoney(n)}</span>`;
  }
  if (signed) return cellMoneySigned(val);
  return cellMoney(val);
}

const RESULTADO_SINAL_LABEL = { '+': '(+)', '-': '(−)', '=': '=' };

function renderResultadoSinal(sinal) {
  if (!sinal) return '';
  const label = RESULTADO_SINAL_LABEL[sinal] || sinal;
  const cls =
    sinal === '+'
      ? 'fin-resultado-sinal--plus'
      : sinal === '-'
        ? 'fin-resultado-sinal--minus'
        : sinal === '='
          ? 'fin-resultado-sinal--eq'
          : '';
  const aria =
    sinal === '+'
      ? 'Soma'
      : sinal === '-'
        ? 'Subtrai'
        : sinal === '='
          ? 'Resultado'
          : '';
  return `<span class="fin-resultado-sinal ${cls}"${aria ? ` aria-label="${aria}"` : ''}>${label}</span>`;
}

function renderResultadoFinal(resultadoFinal) {
  if (!resultadoFinal?.linhas?.length) return '';

  const fat = resultadoFinal.faturamentoPraca || { previsto: 0, realizado: 0, taxaPct: 0.2 };
  const taxaPctLabel = `${Math.round((fat.taxaPct ?? 0.2) * 100)}%`;

  return `
      <section class="financeiro-resultado-final" id="financeiro-resultado-final" aria-label="Resultado final">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Resultado final</h2>
          <span class="financeiro-painel-lead">Consolidação financeira do evento · taxa praça ${taxaPctLabel}</span>
        </div>
        <div class="financeiro-resultado-final-fat">
          <span class="financeiro-resultado-final-fat-label">Faturamento praça de alimentação (prévia)</span>
          <div class="financeiro-resultado-final-fat-inputs">
            <label class="financeiro-resultado-final-fat-field">
              <span>Previsto</span>
              <input type="text" class="fin-inline-input fin-inline-money fin-resultado-fat-previsto" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(fat.previsto))}" title="Base para taxa prevista (${taxaPctLabel})" />
            </label>
            <label class="financeiro-resultado-final-fat-field">
              <span>Realizado</span>
              <input type="text" class="fin-inline-input fin-inline-money fin-resultado-fat-realizado" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(fat.realizado))}" title="Base para taxa realizada (${taxaPctLabel})" />
            </label>
          </div>
          <span class="financeiro-resultado-final-fat-hint">Taxa alimentação = ${taxaPctLabel} do faturamento informado</span>
        </div>
        <div class="table-wrap">
          <table class="table-financeiro-custos table-financeiro-resultado-final">
            <thead>
              <tr>
                <th class="fin-col-sinal" scope="col" aria-label="Operação">Op.</th>
                <th>Descrição</th>
                <th class="fin-col-money">Previsto</th>
                <th class="fin-col-money fin-col-realizado">Realizado</th>
              </tr>
            </thead>
            <tbody>
              ${resultadoFinal.linhas
                .map((l) => {
                  const rowCls = [
                    l.destaque ? 'fin-resultado-row--destaque' : '',
                    l.aporte ? 'fin-resultado-row--aporte' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const signed = l.id === 'resultado-final';
                  const aporte = l.aporte === true;
                  return `
              <tr class="${rowCls}" data-resultado-id="${escapeHtml(l.id)}">
                <td class="fin-col-sinal">${renderResultadoSinal(l.sinal)}</td>
                <td class="fin-resultado-desc">${escapeHtml(l.nome)}</td>
                <td class="fin-col-money">${cellResultadoVal(l.previsto, { signed })}</td>
                <td class="fin-col-money fin-col-realizado">${cellResultadoVal(l.realizado, { signed, aporte })}</td>
              </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <p class="financeiro-resultado-final-formulas">
          <strong>Previsto:</strong> ${escapeHtml(resultadoFinal.formulas?.resultadoFinalPrevisto || 'Arrecadação total − Custo total')}
          · <strong>Realizado:</strong> ${escapeHtml(resultadoFinal.formulas?.resultadoFinalRealizado || '')}
        </p>
      </section>`;
}

function renderCategoriaResumoRow(c, { total = false, color = null } = {}) {
  const rowClass = total ? 'fin-custo-total' : 'fin-custo-row';
  const catCell = total
    ? escapeHtml(c.categoriaNome)
    : `<span class="fin-cat-with-swatch">${renderFinSwatch(color)}<span>${escapeHtml(c.categoriaNome)}</span></span>`;
  return `
              <tr class="${rowClass}">
                <td class="fin-col-money">${cellMoney(c.bonificado)}</td>
                <td class="fin-custo-cat">${catCell}</td>
                <td class="fin-col-money">${cellMoney(c.pre)}</td>
                <td class="fin-col-money">${cellMoney(c.pos)}</td>
                <td class="fin-col-money fin-val--pos">${cellMoney(c.realizado)}</td>
                <td class="fin-col-money">${cellMoneySigned(c.faltaPre)}</td>
                <td class="fin-col-money">${cellMoney(c.custoTotal)}</td>
                <td class="fin-col-money">${cellMoneySigned(c.faltaPagar)}</td>
              </tr>`;
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
  let sumarioSaving = false;
  let vendaHoraSaving = false;
  let bebidaSaving = false;
  let faturamentoSaving = false;

  function applyResultadoFinalFromResponse(res) {
    if (!res?.resultadoFinal) return;
    painel.resultadoFinal = res.resultadoFinal;
    refreshResultadoFinal();
  }

  function recalcSumarioTotais() {
    const sumario = painel?.sumarioArrecadacao;
    const linhas = sumario?.linhas;
    if (!linhas?.length) return;
    const grupos = resolveSumarioGrupos({ ...sumario, totaisPre: null, totaisPos: null, totais: null });
    sumario.linhasPre = grupos.linhasPre;
    sumario.linhasPos = grupos.linhasPos;
    sumario.totaisPre = grupos.totaisPre;
    sumario.totaisPos = grupos.totaisPos;
    sumario.totais = grupos.totais;
  }

  function applySumarioArrecadacaoFromResponse(res) {
    if (!res?.sumarioArrecadacao) return;
    painel.sumarioArrecadacao = res.sumarioArrecadacao;
    refreshSumarioArrecadacao();
    refreshFaseComparativoCharts();
    applyResultadoFinalFromResponse(res);
  }

  function refreshFaseComparativoCharts() {
    const host = document.querySelector('.financeiro-fase-charts');
    if (!host || !painel) return;
    const html = renderFaseComparativoCharts(
      painel.totaisContasPagar || painel.custos?.totaisContasPagar || painel.custos?.totais,
      painel.sumarioArrecadacao,
    );
    if (!html.trim()) {
      host.remove();
      return;
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (next) host.replaceWith(next);
  }

  function refreshSumarioArrecadacao() {
    const host = document.getElementById('financeiro-sumario-arrecadacao');
    if (!host || !painel?.sumarioArrecadacao) return;
    const html = renderSumarioArrecadacao(painel.sumarioArrecadacao);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (next) {
      host.replaceWith(next);
      bindSumarioArrecadacaoEditors();
    }
  }

  async function saveSumarioPrevisto(input) {
    if (sumarioSaving || !input) return;
    const chave = input.dataset.chave;
    const linha = painel?.sumarioArrecadacao?.linhas?.find((l) => l.id === chave);
    if (!linha) return;

    const parsed = parseValor(input.value);
    if (parsed == null) {
      input.value = formatValorInput(linha.previsto);
      return;
    }
    if (Math.abs(parsed - (Number(linha.previsto) || 0)) < 0.005) {
      input.value = formatValorInput(linha.previsto);
      return;
    }

    const prev = linha.previsto;
    sumarioSaving = true;
    input.disabled = true;
    input.classList.add('fin-sumario-previsto--saving');

    try {
      const res = await patchSumarioArrecadacaoPrevisto(chave, parsed);
      if (res?.sumarioArrecadacao) {
        painel.sumarioArrecadacao = res.sumarioArrecadacao;
      } else {
        linha.previsto = parsed;
        linha.previstoManual = true;
        if (res?.linha?.id) linha.linhaId = res.linha.id;
        recalcSumarioTotais();
      }
      refreshSumarioArrecadacao();
      refreshFaseComparativoCharts();
      applyResultadoFinalFromResponse(res);
    } catch (err) {
      linha.previsto = prev;
      input.value = formatValorInput(prev);
      input.classList.add('fin-sumario-previsto--error');
      setTimeout(() => input.classList.remove('fin-sumario-previsto--error'), 2000);
      console.error(err);
    } finally {
      sumarioSaving = false;
      input.disabled = false;
      input.classList.remove('fin-sumario-previsto--saving');
    }
  }

  function refreshResultadoFinal() {
    const host = document.getElementById('financeiro-resultado-final');
    if (!host || !painel?.resultadoFinal) return;
    const html = renderResultadoFinal(painel.resultadoFinal);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (next) {
      host.replaceWith(next);
      bindResultadoFinalEditors();
    }
  }

  async function saveFaturamentoPraca(input, field) {
    if (faturamentoSaving || !input) return;
    const parsed = parseValor(input.value);
    if (parsed == null) {
      const cur =
        field === 'previsto'
          ? painel?.resultadoFinal?.faturamentoPraca?.previsto
          : painel?.resultadoFinal?.faturamentoPraca?.realizado;
      input.value = formatValorInput(cur ?? 0);
      return;
    }
    const fat = painel?.resultadoFinal?.faturamentoPraca || {};
    const current = field === 'previsto' ? Number(fat.previsto) || 0 : Number(fat.realizado) || 0;
    if (Math.abs(parsed - current) < 0.005) {
      input.value = formatValorInput(current);
      return;
    }

    faturamentoSaving = true;
    input.disabled = true;
    input.classList.add('fin-resultado-fat--saving');

    try {
      const payload =
        field === 'previsto' ? { previsto: parsed } : { realizado: parsed };
      const res = await patchFaturamentoPracaAlimentacao(
        field === 'previsto' ? parsed : undefined,
        field === 'realizado' ? parsed : undefined,
      );
      applyResultadoFinalFromResponse(res);
    } catch (err) {
      input.value = formatValorInput(current);
      input.classList.add('fin-resultado-fat--error');
      setTimeout(() => input.classList.remove('fin-resultado-fat--error'), 2000);
      console.error(err);
    } finally {
      faturamentoSaving = false;
      input.disabled = false;
      input.classList.remove('fin-resultado-fat--saving');
    }
  }

  function bindResultadoFinalEditors() {
    const section = document.getElementById('financeiro-resultado-final');
    if (!section) return;

    section.querySelector('.fin-resultado-fat-previsto')?.addEventListener('input', (e) => {
      maskValorInput(e.target);
    });
    section.querySelector('.fin-resultado-fat-realizado')?.addEventListener('input', (e) => {
      maskValorInput(e.target);
    });

    section.querySelector('.fin-resultado-fat-previsto')?.addEventListener('blur', (e) => {
      saveFaturamentoPraca(e.target, 'previsto');
    });
    section.querySelector('.fin-resultado-fat-realizado')?.addEventListener('blur', (e) => {
      saveFaturamentoPraca(e.target, 'realizado');
    });

    section.querySelectorAll('.fin-resultado-fat-previsto, .fin-resultado-fat-realizado').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });
  }

  function bindSumarioArrecadacaoEditors() {
    const section = document.getElementById('financeiro-sumario-arrecadacao');
    if (!section) return;

    section.querySelectorAll('.fin-sumario-previsto').forEach((input) => {
      input.addEventListener('input', () => maskValorInput(input));
      input.addEventListener('blur', () => saveSumarioPrevisto(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });
  }

  function refreshVendasHora() {
    const host = document.getElementById('financeiro-vendas-hora');
    if (!host || !painel?.vendasHora) return;
    const html = renderVendasHora(painel.vendasHora);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (next) {
      host.replaceWith(next);
      bindVendasHoraEditors();
    }
  }

  async function saveVendaHoraField(input) {
    if (vendaHoraSaving || !input) return;
    const id = Number(input.dataset.id);
    const field = input.dataset.field;
    const item = painel?.vendasHora?.itens?.find((i) => i.id === id);
    if (!item || !field) return;

    let payload = {};
    let parsed;
    if (field === 'valorVenda') {
      parsed = parseValor(input.value);
      if (parsed == null) {
        input.value = formatValorInput(item.valorVenda);
        return;
      }
      if (Math.abs(parsed - (Number(item.valorVenda) || 0)) < 0.005) {
        input.value = formatValorInput(item.valorVenda);
        return;
      }
      payload = { valorVenda: parsed };
    } else {
      const raw = input.value.trim();
      parsed = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        input.value = String(item[field] ?? 0);
        return;
      }
      const current = Number(item[field]) || 0;
      if (parsed === current) return;
      payload = { [field]: parsed };
    }

    const prev = { ...item };
    vendaHoraSaving = true;
    input.disabled = true;
    input.classList.add('fin-venda-hora--saving');

    try {
      const res = await patchVendaHora(id, payload);
      if (res?.vendasHora) {
        painel.vendasHora = res.vendasHora;
      } else if (res?.item) {
        Object.assign(item, res.item);
        painel.vendasHora.totais = painel.vendasHora.itens.reduce(
          (acc, i) => ({
            previsto: acc.previsto + (Number(i.previstoTotal) || 0),
            realizado: acc.realizado + (Number(i.realizadoTotal) || 0),
          }),
          { previsto: 0, realizado: 0 },
        );
      }
      refreshVendasHora();
      applySumarioArrecadacaoFromResponse(res);
    } catch (err) {
      Object.assign(item, prev);
      if (field === 'valorVenda') {
        input.value = formatValorInput(prev.valorVenda);
      } else {
        input.value = String(prev[field] ?? 0);
      }
      input.classList.add('fin-venda-hora--error');
      setTimeout(() => input.classList.remove('fin-venda-hora--error'), 2000);
      console.error(err);
    } finally {
      vendaHoraSaving = false;
      input.disabled = false;
      input.classList.remove('fin-venda-hora--saving');
    }
  }

  function bindVendasHoraEditors() {
    const section = document.getElementById('financeiro-vendas-hora');
    if (!section) return;

    section.querySelectorAll('.fin-venda-hora-valor').forEach((input) => {
      input.addEventListener('input', () => maskValorInput(input));
      input.addEventListener('blur', () => saveVendaHoraField(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    section.querySelectorAll('.fin-venda-hora-qty').forEach((input) => {
      input.addEventListener('blur', () => saveVendaHoraField(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    section.querySelector('#financeiro-vendas-hora-carregar')?.addEventListener('click', async () => {
      const btn = section.querySelector('#financeiro-vendas-hora-carregar');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Carregando…';
      try {
        const res = await carregarModeloVendasHora();
        if (res?.vendasHora) {
          painel.vendasHora = res.vendasHora;
          refreshVendasHora();
          applySumarioArrecadacaoFromResponse(res);
        }
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Carregar modelo vendas na hora';
      }
    });
  }

  function refreshBebidas() {
    const host = document.getElementById('financeiro-bebidas');
    if (!host || !painel?.bebidas) return;
    const html = renderBebidas(painel.bebidas);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (next) {
      host.replaceWith(next);
      bindBebidasEditors();
    }
  }

  async function saveBebidaField(input) {
    if (bebidaSaving || !input) return;
    const id = Number(input.dataset.id);
    const field = input.dataset.field;
    const item = painel?.bebidas?.itens?.find((i) => i.id === id);
    if (!item || !field) return;

    let payload = {};
    let parsed;
    if (field === 'valorUnit') {
      parsed = parseValor(input.value);
      if (parsed == null) {
        input.value = formatValorInput(item.valorUnit);
        return;
      }
      if (Math.abs(parsed - (Number(item.valorUnit) || 0)) < 0.005) {
        input.value = formatValorInput(item.valorUnit);
        return;
      }
      payload = { valorUnit: parsed };
    } else {
      const raw = input.value.trim();
      parsed = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        input.value = String(item[field] ?? 0);
        return;
      }
      const current = Number(item[field]) || 0;
      if (parsed === current) return;
      payload = { [field]: parsed };
    }

    const prev = { ...item };
    bebidaSaving = true;
    input.disabled = true;
    input.classList.add('fin-bebida--saving');

    try {
      const res = await patchBebida(id, payload);
      if (res?.bebidas) {
        painel.bebidas = res.bebidas;
      } else if (res?.item) {
        Object.assign(item, res.item);
        painel.bebidas.totais = painel.bebidas.itens.reduce(
          (acc, i) => ({
            previstoReceita: acc.previstoReceita + (Number(i.previstoReceita) || 0),
            realizadoReceita: acc.realizadoReceita + (Number(i.realizadoReceita) || 0),
          }),
          { previstoReceita: 0, realizadoReceita: 0 },
        );
      }
      refreshBebidas();
      applySumarioArrecadacaoFromResponse(res);
    } catch (err) {
      Object.assign(item, prev);
      if (field === 'valorUnit') {
        input.value = formatValorInput(prev.valorUnit);
      } else {
        input.value = String(prev[field] ?? 0);
      }
      input.classList.add('fin-bebida--error');
      setTimeout(() => input.classList.remove('fin-bebida--error'), 2000);
      console.error(err);
    } finally {
      bebidaSaving = false;
      input.disabled = false;
      input.classList.remove('fin-bebida--saving');
    }
  }

  function bindBebidasEditors() {
    const section = document.getElementById('financeiro-bebidas');
    if (!section) return;

    section.querySelectorAll('.fin-bebida-money').forEach((input) => {
      input.addEventListener('input', () => maskValorInput(input));
      input.addEventListener('blur', () => saveBebidaField(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    section.querySelectorAll('.fin-bebida-qty').forEach((input) => {
      input.addEventListener('blur', () => saveBebidaField(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    section.querySelector('#financeiro-bebidas-carregar')?.addEventListener('click', async () => {
      const btn = section.querySelector('#financeiro-bebidas-carregar');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Carregando…';
      try {
        const res = await carregarModeloBebidas();
        if (res?.bebidas) {
          painel.bebidas = res.bebidas;
          refreshBebidas();
          applySumarioArrecadacaoFromResponse(res);
        }
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Carregar modelo arrecadação bebidas';
      }
    });
  }

  function renderPainel() {
    if (!els.painelBody) return;

    const custos = painel?.custos?.totais || { previsto: 0, realizado: 0, falta: 0 };
    const ent = painel?.entradas?.total || { previsto: 0, realizado: 0, falta: 0 };
    const bonificado =
      Number(
        painel?.resultado?.bonificado ??
          painel?.totaisContasPagar?.bonificado ??
          painel?.custos?.totaisContasPagar?.bonificado ??
          0,
      ) || 0;
    const r = painel?.resultado || {
      saldoPrevisto: ent.previsto - custos.previsto,
      bonificado,
      faltaArrecadar: Math.max(0, custos.previsto - ent.previsto - bonificado),
    };
    const nItens = painel?.totalItens || 0;
    const faltaArrecadarSub =
      bonificado > 0
        ? `abatido ${cellMoney(bonificado)} bonificado (prefeitura)`
        : 'para cobrir o custo previsto';

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
        <div class="financeiro-kpi${bonificado > 0 ? ' financeiro-kpi--bonificado' : ''}">
          <span class="financeiro-kpi-label">Bonificado (prefeitura)</span>
          <strong class="financeiro-kpi-val">${cellMoney(bonificado)}</strong>
          <span class="financeiro-kpi-sub">voucher prefeitura · abatido da arrecadação</span>
        </div>
        <div class="financeiro-kpi ${r.faltaArrecadar > 0 ? 'financeiro-kpi--warn' : ''}">
          <span class="financeiro-kpi-label">Falta arrecadar</span>
          <strong class="financeiro-kpi-val">${cellMoney(r.faltaArrecadar)}</strong>
          <span class="financeiro-kpi-sub">${faltaArrecadarSub}</span>
        </div>
      </div>
      ${renderFaseComparativoCharts(
        painel?.totaisContasPagar || painel?.custos?.totaisContasPagar || painel?.custos?.totais,
        painel?.sumarioArrecadacao,
      )}
      ${
        painel?.custos?.porCategoria?.length
          ? (() => {
              const custoSlices = buildCustoPieSlices(painel.custos.porCategoria);
              const { colorByIndex: custoColors } = resolvePieSliceColors(custoSlices);
              const pieCustos = renderPieChart(custoSlices, {
                title: 'Participação no custo do evento',
                showLegend: false,
              });
              return `
      <section class="financeiro-custos" aria-label="Contas a pagar por categoria">
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">Contas a pagar por categoria</h2>
          <span class="financeiro-painel-lead">Resumo pré/pós, realizado e pendências por categoria</span>
        </div>
        <div class="financeiro-chart-row">
        <div class="table-wrap table-wrap--financeiro-categorias">
          <table class="table-financeiro-custos table-financeiro-custos--painel">
            <thead>
              <tr>
                <th class="fin-col-money">Bonificado</th>
                <th>Categoria</th>
                <th class="fin-col-money">Pré</th>
                <th class="fin-col-money">Pós</th>
                <th class="fin-col-money">Realizado</th>
                <th class="fin-col-money">Falta pré</th>
                <th class="fin-col-money">Custo total</th>
                <th class="fin-col-money">Falta pagar</th>
              </tr>
            </thead>
            <tbody>
              ${painel.custos.porCategoria
                .map((c, i) => renderCategoriaResumoRow(c, { color: custoColors[i] }))
                .join('')}
            </tbody>
            <tfoot>
              ${renderCategoriaResumoRow(painel.totaisContasPagar || painel.custos.totaisContasPagar || {}, {
                total: true,
              })}
            </tfoot>
          </table>
        </div>
        <div class="financeiro-pie-wrap" aria-label="Gráfico de participação no custo">${pieCustos}</div>
        </div>
      </section>`;
            })()
          : ''
      }
      ${renderVendasHora(painel?.vendasHora)}
      ${renderBebidas(painel?.bebidas)}
      ${renderSumarioArrecadacao(painel?.sumarioArrecadacao)}
      ${renderResultadoFinal(painel?.resultadoFinal)}
    `;

    bindSumarioArrecadacaoEditors();
    bindVendasHoraEditors();
    bindBebidasEditors();
    bindResultadoFinalEditors();
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
