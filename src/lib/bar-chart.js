import { escapeHtml, fmtMoney } from './format.js';

export const BAR_CHART_COLORS = {
  previsto: '#8b5cf6',
  falta: '#f59e0b',
  realizado: '#22c55e',
};

function splitLabel(label) {
  const text = String(label).trim();
  if (!text.includes(' ')) return [text];
  const words = text.split(/\s+/);
  if (words.length === 2) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function renderLabelEl(cx, baseY, label, fontSize = 10) {
  const lines = splitLabel(label);
  if (lines.length === 1) {
    return `<text class="bar-chart-label" x="${cx}" y="${baseY + 15}" text-anchor="middle" font-size="${fontSize}">${escapeHtml(lines[0])}</text>`;
  }
  const lineGap = fontSize + 3;
  return `<text class="bar-chart-label" x="${cx}" y="${baseY + 13}" text-anchor="middle" font-size="${fontSize}">
    <tspan x="${cx}" dy="0">${escapeHtml(lines[0])}</tspan>
    <tspan x="${cx}" dy="${lineGap}">${escapeHtml(lines[1])}</tspan>
  </text>`;
}

/**
 * Gráfico de barras verticais em SVG puro.
 * @param {{ label: string, value: number, color?: string }[]} bars
 * @param {{ title?: string, width?: number, height?: number }} [opts]
 */
export function renderBarChart(bars, { title = '', width = 280, height = 200 } = {}) {
  const items = (bars || []).map((b) => ({
    label: String(b.label || '—'),
    value: Math.max(0, Number(b.value) || 0),
    color: b.color || BAR_CHART_COLORS.previsto,
  }));

  if (!items.length) return '';

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const n = items.length;
  const barW = n <= 2 ? 52 : 40;
  const gap = n <= 2 ? 52 : 28;
  const chartH = 96;
  const topPad = 30;
  const labelH = 38;
  const viewW = 280;
  const viewH = topPad + chartH + labelH;
  const totalW = n * barW + Math.max(0, n - 1) * gap;
  const startX = (viewW - totalW) / 2;
  const baseY = topPad + chartH;
  const valFontSize = 11;
  const labelFontSize = 10;

  const barEls = items
    .map((item, i) => {
      const h = item.value > 0 ? (item.value / maxVal) * (chartH - 12) : 0;
      const x = startX + i * (barW + gap);
      const y = baseY - (h || 2);
      const barH = h || 2;
      const valLabel = fmtMoney(item.value);
      const cx = x + barW / 2;
      const valY = Math.max(topPad + 4, y - 12);
      return `
      <g class="bar-chart-group">
        <text class="bar-chart-val" x="${cx}" y="${valY}" text-anchor="middle" font-size="${valFontSize}">${escapeHtml(valLabel)}</text>
        <rect class="bar-chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${item.color}" />
        ${renderLabelEl(cx, baseY, item.label, labelFontSize)}
      </g>`;
    })
    .join('');

  const ariaLabel = items.map((i) => `${i.label}: ${fmtMoney(i.value)}`).join(', ');

  return `
    <div class="bar-chart-block" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${title ? `<p class="bar-chart-title">${escapeHtml(title)}</p>` : ''}
      <svg class="bar-chart-svg" viewBox="0 0 ${viewW} ${viewH}" width="${width}" height="${height}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        ${barEls}
      </svg>
    </div>`;
}
