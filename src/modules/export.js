import { LABELS } from '../lib/constants.js';
import {
  fmtDate,
  formatValorInput,
  valorNegociadoExibido,
  valoresPagamentoExibidos,
} from '../lib/format.js';

export function exportCSV(store) {
  const { spaces, currentGrupo, spaceNumeros } = store;
  const header = [
    'Agrupamento',
    'Espaco',
    'Nome',
    'Status',
    'TipoComercio',
    'Participante',
    'Custo',
    'ValorNegociado',
    'JaPago',
    'Faltante',
    'GrupoVenda',
    'Observacoes',
    'UltimaAlteracao',
  ];
  const rows = [header];
  const grupoNome = currentGrupo?.nome || '';

  for (const numero of spaceNumeros()) {
    const data = spaces[numero];
    rows.push([
      grupoNome,
      numero,
      data?.label || `Espaço ${numero}`,
      LABELS[data.status] || data.status,
      data.tipo || '',
      data.participanteNome || '',
      data.custo != null ? formatValorInput(data.custo) : '',
      (() => {
        const v = valorNegociadoExibido(spaces, numero, data);
        return v != null ? formatValorInput(v) : '';
      })(),
      (() => {
        const v = valoresPagamentoExibidos(spaces, numero, data);
        return v ? formatValorInput(v.pago) : '';
      })(),
      (() => {
        const v = valoresPagamentoExibidos(spaces, numero, data);
        return v ? formatValorInput(v.falta) : '';
      })(),
      data.saleGroup || '',
      data.obs || '',
      data.updatedAt ? fmtDate(data.updatedAt) : '',
    ]);
  }

  const slug = currentGrupo?.slug || 'espacos';
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `opalapa-${slug}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
