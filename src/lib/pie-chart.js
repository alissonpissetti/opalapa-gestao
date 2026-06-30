import { escapeHtml, fmtMoney, fmtPercent } from './format.js';

export const PIE_SLICE_COLORS = [
  '#4338ca',
  '#5dcaa5',
  '#fac775',
  '#818cf8',
  '#22c55e',
  '#eab308',
  '#8b5cf6',
  '#06b6d4',
];

function polarPoint(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSlice(cx, cy, r, startAngle, endAngle) {
  const sweep = endAngle - startAngle;
  if (sweep >= 359.99) {
    return null;
  }
  const start = polarPoint(cx, cy, r, startAngle);
  const end = polarPoint(cx, cy, r, endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/**
 * Atribui cores na mesma ordem das fatias do gráfico (apenas itens com value > 0).
 * @param {{ label: string, value: number, color?: string }[]} slices
 * @returns {{ normalized: object[], valid: object[], total: number, colorByIndex: (string|null)[] }}
 */
export function resolvePieSliceColors(slices) {
  const normalized = slices.map((s, index) => ({
    index,
    label: String(s.label || '—'),
    value: Math.max(0, Number(s.value) || 0),
    color: s.color,
  }));

  const valid = normalized.filter((s) => s.value > 0);
  const total = valid.reduce((sum, s) => sum + s.value, 0);
  const colorByIndex = new Array(normalized.length).fill(null);

  let colorIdx = 0;
  for (const slice of normalized) {
    if (slice.value > 0) {
      colorByIndex[slice.index] =
        slice.color || PIE_SLICE_COLORS[colorIdx % PIE_SLICE_COLORS.length];
      colorIdx += 1;
    }
  }

  return { normalized, valid, total, colorByIndex };
}

/** @param {string|null|undefined} color */
export function renderFinSwatch(color) {
  if (!color) {
    return '<span class="fin-swatch fin-swatch--empty" aria-hidden="true"></span>';
  }
  return `<span class="fin-swatch" style="background:${color}" aria-hidden="true"></span>`;
}

/**
 * @param {{ label: string, value: number, color?: string }[]} slices
 * @param {{ title?: string, size?: number, showLegend?: boolean }} [opts]
 */
export function renderPieChart(slices, { title = '', size = 168, showLegend = false } = {}) {
  const { valid, total, colorByIndex } = resolvePieSliceColors(slices);
  if (total <= 0) return '';

  const cx = 50;
  const cy = 50;
  const r = 45;
  let angle = 0;

  const paths = valid
    .map((slice) => {
      const color = colorByIndex[slice.index];
      const sweep = (slice.value / total) * 360;
      const startAngle = angle;
      const endAngle = angle + sweep;
      angle = endAngle;

      if (sweep >= 359.99) {
        return `<circle class="pie-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${color}" />`;
      }

      const d = describeSlice(cx, cy, r, startAngle, endAngle);
      return `<path class="pie-slice" d="${d}" fill="${color}" />`;
    })
    .join('');

  const legend = showLegend
    ? valid
        .map((slice) => {
          const color = colorByIndex[slice.index];
          const pct = fmtPercent(slice.value, total) || '0%';
          return `
        <div class="pie-legend-item">
          <span class="pie-legend-dot" style="background:${color}"></span>
          <span class="pie-legend-text">
            <span class="pie-legend-label">${escapeHtml(slice.label)}</span>
            <span class="pie-legend-meta">
              <span class="pie-legend-pct">${pct}</span>
              <span class="pie-legend-val">${fmtMoney(slice.value)}</span>
            </span>
          </span>
        </div>`;
        })
        .join('')
    : '';

  const ariaLabel = valid
    .map((s) => `${s.label}: ${fmtPercent(s.value, total) || '0%'}`)
    .join(', ');

  return `
    <aside class="financeiro-pie-wrap">
      <div class="pie-chart-block" role="img" aria-label="${escapeHtml(ariaLabel)}">
        ${title ? `<p class="pie-chart-title">${escapeHtml(title)}</p>` : ''}
        <div class="pie-chart-layout${showLegend ? '' : ' pie-chart-layout--solo'}">
          <div class="pie-chart" style="width:${size}px;height:${size}px">
            <svg viewBox="0 0 100 100" aria-hidden="true">${paths}</svg>
          </div>
          ${showLegend ? `<div class="pie-legend">${legend}</div>` : ''}
        </div>
      </div>
    </aside>`;
}
