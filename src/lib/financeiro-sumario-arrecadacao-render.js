import { escapeHtml, fmtMoney, formatValorInput } from './format.js';
import { renderFinSwatch, renderPieChart, resolvePieSliceColors } from './pie-chart.js';

function cellMoney(val) {
  return fmtMoney(val);
}

function buildArrecadacaoPieSlices(linhas) {
  return linhas.map((l) => ({
    label: l.nome,
    value: Number(l.previsto) || 0,
  }));
}

export function resolveSumarioGrupos(sumario) {
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

function renderPrevistoCell(l, editable) {
  if (!editable) {
    if (l.previstoEditavel === false) {
      return `<span class="fin-val fin-sumario-previsto-readonly" title="Calculado automaticamente pelo sistema">${cellMoney(l.previsto)}</span><span class="fin-sumario-auto-hint">calculado automaticamente</span>`;
    }
    return `<span class="fin-val">${cellMoney(l.previsto)}</span>`;
  }
  if (l.previstoEditavel === false) {
    return `<span class="fin-val fin-sumario-previsto-readonly" title="Calculado automaticamente pelo sistema">${cellMoney(l.previsto)}</span><span class="fin-sumario-auto-hint">calculado automaticamente</span>`;
  }
  return `<input type="text" class="fin-inline-input fin-inline-money fin-sumario-previsto" data-chave="${escapeHtml(l.id)}" title="Valor previsto editável" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(l.previsto))}" />`;
}

function renderRealizadoCell(l, editable) {
  if (editable && l.realizadoEditavel === true) {
    return `<input type="text" class="fin-inline-input fin-inline-money fin-sumario-realizado" data-chave="${escapeHtml(l.id)}" title="Valor realizado editável manualmente" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(l.realizado))}" />`;
  }
  return cellMoney(l.realizado);
}

function renderSumarioLinha(l, colorIndex, arrecadacaoColors, editable) {
  return `
              <tr data-sumario-chave="${escapeHtml(l.id)}">
                <td class="fin-custo-cat"><span class="fin-cat-with-swatch">${renderFinSwatch(arrecadacaoColors[colorIndex])}<span>${escapeHtml(l.nome)}</span></span></td>
                <td class="fin-col-money fin-col-previsto">${renderPrevistoCell(l, editable)}</td>
                <td class="fin-col-money fin-col-realizado">${renderRealizadoCell(l, editable)}</td>
              </tr>`;
}

function renderSumarioGrupo({ titulo, grupo, linhas, totais, colorById, arrecadacaoColors, editable }) {
  if (!linhas.length) return '';
  const rows = linhas
    .map((l) => renderSumarioLinha(l, colorById.get(l.id) ?? 0, arrecadacaoColors, editable))
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

/**
 * @param {object} sumario
 * @param {{ editable?: boolean, showPie?: boolean, sectionId?: string, title?: string, lead?: string, wrapSection?: boolean, sectionClass?: string }} [options]
 */
export function renderSumarioArrecadacao(sumario, options = {}) {
  if (!sumario?.linhas?.length) return '';

  const {
    editable = true,
    showPie = true,
    sectionId = 'financeiro-sumario-arrecadacao',
    title = 'Sumário de arrecadação',
    lead = 'Previsto editável por categoria · realizado manual em ingressos digitais',
    wrapSection = true,
    sectionClass = 'financeiro-arrecadacao',
  } = options;

  const { linhasPre, linhasPos, totaisPre, totaisPos, totais } = resolveSumarioGrupos(sumario);
  const arrecadacaoSlices = buildArrecadacaoPieSlices(sumario.linhas);
  const { colorByIndex: arrecadacaoColors } = resolvePieSliceColors(arrecadacaoSlices);
  const colorById = new Map(sumario.linhas.map((l, i) => [l.id, i]));
  const pieArrecadacao = showPie
    ? renderPieChart(arrecadacaoSlices, {
        title: 'Participação na arrecadação (previsto)',
        showLegend: false,
      })
    : '';

  const chartRowClass = showPie ? 'financeiro-chart-row' : 'financeiro-chart-row financeiro-chart-row--no-pie';
  const pieHtml = showPie
    ? `<div class="financeiro-pie-wrap" aria-label="Gráfico de participação na arrecadação">${pieArrecadacao}</div>`
    : '';

  const body = `
        <div class="financeiro-custos-head">
          <h2 class="financeiro-custos-title">${escapeHtml(title)}</h2>
          <span class="financeiro-painel-lead">${escapeHtml(lead)}</span>
        </div>
        <div class="${chartRowClass}">
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
              editable,
            })}
            ${renderSumarioGrupo({
              titulo: 'Arrecadação pós',
              grupo: 'pos',
              linhas: linhasPos,
              totais: totaisPos,
              colorById,
              arrecadacaoColors,
              editable,
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
        ${pieHtml}
        </div>`;

  if (!wrapSection) return body;

  return `
      <section class="${sectionClass}" id="${escapeHtml(sectionId)}" aria-label="Sumário de arrecadação">${body}
      </section>`;
}
