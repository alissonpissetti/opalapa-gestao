export const FEIRA_COMERCIAL_2_SEED = Array.from({ length: 6 }, (_, i) => {
  const id = i + 1;
  return {
    id,
    label: `Espaço ${id} (4×3m)`,
    points: '',
    custo: 840,
  };
});

export const FEIRA_COMERCIAL_2_COUNT = FEIRA_COMERCIAL_2_SEED.length;
