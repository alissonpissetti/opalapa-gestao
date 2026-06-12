export const STATUS_ORDER = ['disp', 'lead', 'neg', 'res', 'vend'];

export const FUNIL_STATUS_ORDER = ['disp', 'lead', 'neg', 'res', 'vend'];

export const COLORS = {
  disp: '#5DCAA5',
  lead: '#C084FC',
  neg: '#85B7EB',
  res: '#FAC775',
  vend: '#E24B4A',
};

export const LABELS = {
  disp: 'Disponível',
  lead: 'Lead',
  neg: 'Em negociação',
  res: 'Reservado',
  vend: 'Vendido / Fechado',
};

export const MAP_VIEWBOX = { width: 1392, height: 712 };

export const MOTIVOS_PERDA_LEAD = [
  { value: 'preco', label: 'Preço alto' },
  { value: 'desistiu', label: 'Desistiu do evento' },
  { value: 'outro_evento', label: 'Escolheu outro evento' },
  { value: 'sem_retorno', label: 'Sem retorno / não respondeu' },
  { value: 'perfil', label: 'Fora do perfil' },
  { value: 'outro', label: 'Outro' },
];
