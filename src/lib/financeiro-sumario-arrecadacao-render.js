import { escapeHtml, fmtMoney, formatValorInput } from './format.js';
import { renderFinSwatch, renderPieChart, resolvePieSliceColors } from './pie-chart.js';
import {
  TAXA_PRACA_ALIMENTACAO_PCT,
  calcTaxaPracaFromFaturamentoBruto,
} from '../../shared/financeiro-taxa-praca.js';

/** Campos editáveis do faturamento bruto da praça (base da taxa de 20%). */
export function renderFaturamentoPracaAlimentacao(faturamentoPraca = {}) {
  const fat = faturamentoPraca || {};
  const taxaPct = fat.taxaPct ?? TAXA_PRACA_ALIMENTACAO_PCT;
  const taxaPctLabel = `${Math.round(taxaPct * 100)}%`;
  const taxaPrev = calcTaxaPracaFromFaturamentoBruto(fat.previsto, taxaPct);
  const taxaReal = calcTaxaPracaFromFaturamentoBruto(fat.realizado, taxaPct);

  return `
        <div class="financeiro-resultado-final-fat financeiro-faturamento-praca" id="financeiro-faturamento-praca">
          <span class="financeiro-resultado-final-fat-label">Faturamento bruto da praça de alimentação</span>
          <div class="financeiro-resultado-final-fat-inputs">
            <label class="financeiro-resultado-final-fat-field">
              <span>Previsto (bruto)</span>
              <input type="text" class="fin-inline-input fin-inline-money fin-resultado-fat-previsto" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(fat.previsto))}" title="Faturamento bruto previsto da praça — base para taxa ${taxaPctLabel}" />
            </label>
            <label class="financeiro-resultado-final-fat-field">
              <span>Realizado (bruto)</span>
              <input type="text" class="fin-inline-input fin-inline-money fin-resultado-fat-realizado" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(fat.realizado))}" title="Faturamento bruto realizado da praça — base para taxa ${taxaPctLabel}" />
            </label>
          </div>
          <span class="financeiro-resultado-final-fat-hint">Taxa alimentação (${taxaPctLabel}): previsto ${cellMoney(taxaPrev)} · realizado ${cellMoney(taxaReal)}</span>
        </div>`;
}

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

function renderPrevistoCell(l, editable, faturamentoPraca) {
  if (l.id === 'taxa-praca-alimentacao' && faturamentoPraca) {
    const pct = faturamentoPraca.taxaPct ?? TAXA_PRACA_ALIMENTACAO_PCT;
    const val = calcTaxaPracaFromFaturamentoBruto(faturamentoPraca.previsto, pct);
    return `<span class="fin-val fin-sumario-previsto-readonly" title="20% do faturamento bruto previsto">${cellMoney(val)}</span><span class="fin-sumario-auto-hint">20% do faturamento bruto</span>`;
  }
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

function renderRealizadoCell(l, editable, faturamentoPraca) {
  if (l.id === 'taxa-praca-alimentacao' && faturamentoPraca) {
    const pct = faturamentoPraca.taxaPct ?? TAXA_PRACA_ALIMENTACAO_PCT;
    const bruto = Number(faturamentoPraca.realizado) || 0;
    const val = calcTaxaPracaFromFaturamentoBruto(bruto, pct);
    const brutoFmt = cellMoney(bruto);
    return `<span class="fin-val fin-sumario-previsto-readonly" title="20% de ${brutoFmt} (faturamento bruto realizado)">${cellMoney(val)}</span><span class="fin-sumario-auto-hint">20% do faturamento bruto</span>`;
  }
  if (editable && l.realizadoEditavel === true) {
    return `<input type="text" class="fin-inline-input fin-inline-money fin-sumario-realizado" data-chave="${escapeHtml(l.id)}" title="Valor realizado editável manualmente" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatValorInput(l.realizado))}" />`;
  }
  return cellMoney(l.realizado);
}

function renderSumarioLinha(l, colorIndex, arrecadacaoColors, editable, faturamentoPraca) {
  return `
              <tr data-sumario-chave="${escapeHtml(l.id)}">
                <td class="fin-custo-cat"><span class="fin-cat-with-swatch">${renderFinSwatch(arrecadacaoColors[colorIndex])}<span>${escapeHtml(l.nome)}</span></span></td>
                <td class="fin-col-money fin-col-previsto">${renderPrevistoCell(l, editable, faturamentoPraca)}</td>
                <td class="fin-col-money fin-col-realizado">${renderRealizadoCell(l, editable, faturamentoPraca)}</td>
              </tr>`;
}

function renderSumarioGrupo({
  titulo,
  grupo,
  linhas,
  totais,
  colorById,
  arrecadacaoColors,
  editable,
  faturamentoPraca,
}) {
  if (!linhas.length) return '';
  const rows = linhas
    .map((l) =>
      renderSumarioLinha(l, colorById.get(l.id) ?? 0, arrecadacaoColors, editable, faturamentoPraca),
    )
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
    lead = 'Previsto editável por categoria · faturamento bruto da praça para taxa de 20%',
    wrapSection = true,
    sectionClass = 'financeiro-arrecadacao',
  } = options;

  const faturamentoPraca = sumario.faturamentoPraca || null;
  const taxaPct = faturamentoPraca?.taxaPct ?? TAXA_PRACA_ALIMENTACAO_PCT;
  const linhasParaTotais = (sumario.linhas || []).map((l) => {
    if (l.id !== 'taxa-praca-alimentacao' || !faturamentoPraca) return l;
    return {
      ...l,
      previsto: calcTaxaPracaFromFaturamentoBruto(faturamentoPraca.previsto, taxaPct),
      realizado: calcTaxaPracaFromFaturamentoBruto(faturamentoPraca.realizado, taxaPct),
    };
  });
  const totaisAjustados = (() => {
    const previsto = linhasParaTotais.reduce((s, l) => s + (Number(l.previsto) || 0), 0);
    const realizado = linhasParaTotais.reduce((s, l) => s + (Number(l.realizado) || 0), 0);
    return { previsto, realizado, falta: Math.max(0, previsto - realizado) };
  })();
  const gruposAjustados = resolveSumarioGrupos({
    ...sumario,
    linhas: linhasParaTotais,
    totaisPre: null,
    totaisPos: null,
    totais: null,
  });
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
        ${renderFaturamentoPracaAlimentacao(sumario.faturamentoPraca)}
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
              linhas: gruposAjustados.linhasPre,
              totais: gruposAjustados.totaisPre,
              colorById,
              arrecadacaoColors,
              editable,
              faturamentoPraca,
            })}
            ${renderSumarioGrupo({
              titulo: 'Arrecadação pós',
              grupo: 'pos',
              linhas: gruposAjustados.linhasPos,
              totais: gruposAjustados.totaisPos,
              colorById,
              arrecadacaoColors,
              editable,
              faturamentoPraca,
            })}
            <tfoot>
              <tr class="fin-custo-total" data-sumario-totais>
                <td>Total</td>
                <td class="fin-col-money fin-col-previsto-total">${cellMoney(totaisAjustados.previsto)}</td>
                <td class="fin-col-money fin-col-realizado">${cellMoney(totaisAjustados.realizado)}</td>
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
