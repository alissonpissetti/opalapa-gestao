import { escapeHtml, fmtMoney } from './format.js';

export const BAR_CHART_COLORS = {
  previsto: '#8b5cf6',
  falta: '#f59e0b',
  realizado: '#22c55e',
};

/**
 * Gráfico de barras verticais em SVG puro.
 * @param {{ label: string, value: number, color?: string }[]} bars
 * @param {{ title?: string, width?: number, height?: number }} [opts]
 */
export function renderBarChart(bars, { title = '', width = 220, height = 148 } = {}) {
  const items = (bars || []).map((b) => ({
    label: String(b.label || '—'),
    value: Math.max(0, Number(b.value) || 0),
    color: b.color || BAR_CHART_COLORS.previsto,
  }));

  if (!items.length) return '';

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const chartH = 82;
  const barW = 40;
  const gap = 28;
  const n = items.length;
  const totalW = n * barW + Math.max(0, n - 1) * gap;
  const viewW = 200;
  const startX = (viewW - totalW) / 2;
  const baseY = chartH;

  const labelExtraH = items.some((i) => i.label.length > 14 && i.label.includes(' ')) ? 8 : 0;

  const barEls = items
    .map((item, i) => {
      const h = item.value > 0 ? (item.value / maxVal) * (chartH - 8) : 0;
      const x = startX + i * (barW + gap);
      const y = baseY - (h || 2);
      const barH = h || 2;
      const valLabel = fmtMoney(item.value);
      const cx = x + barW / 2;
      const labelParts = String(item.label).trim().split(/\s+/);
      const labelEl =
        labelParts.length >= 2 && item.label.length > 14
          ? `<text class="bar-chart-label" x="${cx}" y="${baseY + 14}" text-anchor="middle"><tspan x="${cx}" dy="0">${escapeHtml(labelParts[0])}</tspan><tspan x="${cx}" dy="7">${escapeHtml(labelParts.slice(1).join(' '))}</tspan></text>`
          : `<text class="bar-chart-label" x="${cx}" y="${baseY + 16}" text-anchor="middle">${escapeHtml(item.label)}</text>`;
      return `
      <g class="bar-chart-group">
        <text class="bar-chart-val" x="${cx}" y="${Math.max(10, y - 4)}" text-anchor="middle">${escapeHtml(valLabel)}</text>
        <rect class="bar-chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${item.color}" />
        ${labelEl}
      </g>`;
    })
    .join('');

  const ariaLabel = items.map((i) => `${i.label}: ${fmtMoney(i.value)}`).join(', ');

  return `
    <div class="bar-chart-block" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${title ? `<p class="bar-chart-title">${escapeHtml(title)}</p>` : ''}
      <svg class="bar-chart-svg" viewBox="0 0 ${viewW} ${chartH + 24 + labelExtraH}" width="${width}" height="${height + labelExtraH}" aria-hidden="true">
        ${barEls}
      </svg>
    </div>`;
}
