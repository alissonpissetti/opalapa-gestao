/** Taxa de receita sobre o faturamento bruto da praça de alimentação (ex.: 20%). */
export const TAXA_PRACA_ALIMENTACAO_PCT = 0.2;

export function calcTaxaPracaFromFaturamentoBruto(
  faturamentoBruto,
  taxaPct = TAXA_PRACA_ALIMENTACAO_PCT,
) {
  const bruto = Number(faturamentoBruto) || 0;
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  return Math.round(bruto * taxaPct * 100) / 100;
}
