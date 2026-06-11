export const EXPOSITORES_5X5_SEED = Array.from({ length: 20 }, (_, i) => {
  const id = i + 1;
  return {
    id,
    label: `Tenda ${id}`,
    points: '',
  };
});

export const EXPOSITORES_5X5_COUNT = EXPOSITORES_5X5_SEED.length;
