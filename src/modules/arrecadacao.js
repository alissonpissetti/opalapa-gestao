import {
  fetchArrecadacao,
  fetchArrecadacaoById,
  fetchParticipantes,
  fetchSeguidoresHistorico,
  createPatrocinio,
  updateArrecadacao,
  updateParticipante,
  deleteArrecadacao,
  migrateArrecadacaoToArtistico,
  registerPerdaLead,
  fetchPagamentosArrecadacao,
  fetchPagamentosParticipante,
  registerPagamento,
  deletePagamento,
  createTarefaContato,
  fetchTarefasLead,
  concluirTarefaContato,
  saveFunilEtapas,
  fetchFunilEtapas,
  fetchInteracoes,
  createInteracao,
  fetchUsers,
  fetchMarketing,
  fetchTiposComercio,
} from '../lib/api.js';
import {
  fmtMoney,
  fmtDate,
  fmtAgendadoComAs,
  combineDateAndTime,
  isTarefaAtrasada,
  fmtPercent,
  escapeHtml,
  parseValor,
  formatValorInput,
  maskValorInput,
} from '../lib/format.js';
import { LABELS, COLORS, FUNIL_STATUS_ORDER } from '../lib/constants.js';
import { mountContactAvatar } from '../lib/contact-avatar.js';
import { bindWhatsappChatButtons, renderWhatsappPhoneButton } from '../lib/whatsapp-chat.js';

const PAGE_CONFIG = {
  comercial: {
    viewModeKey: 'arrecadacao-view-mode',
    overviewKey: 'arrecadacao-overview-visible',
    viewRootId: 'view-arrecadacao',
    createTipo: 'patrocinio',
    navView: 'arrecadacao',
    ids: {
      summary: 'arrecadacao-summary',
      donut: 'arrecadacao-donut',
      stats: 'arrecadacao-stats',
      table: 'arrecadacao-table',
      disponiveisSection: 'arrecadacao-disponiveis-section',
      disponiveisSummary: 'arrecadacao-disponiveis-summary',
      disponiveisTable: 'arrecadacao-disponiveis-table',
      btnNew: 'btn-patrocinio-new',
      btnFunilConfig: 'btn-funil-config',
      listaView: 'arrecadacao-lista-view',
      kanbanView: 'arrecadacao-kanban-view',
    },
  },
  artistico: {
    viewRootId: 'view-artistico',
    overviewKey: 'artistico-overview-visible',
    createTipo: 'artistico',
    navView: 'artistico',
    listOnly: true,
    ids: {
      summary: 'artistico-summary',
      donut: null,
      stats: 'artistico-stats',
      table: 'artistico-table',
      disponiveisSection: null,
      disponiveisSummary: null,
      disponiveisTable: null,
      btnNew: 'btn-artistico-new',
      btnFunilConfig: 'btn-funil-config-artistico',
      listaView: 'artistico-lista-view',
      kanbanView: null,
    },
  },
};

const TIPO_LABELS = {
  espaco: 'Espaço',
  patrocinio: 'Patrocínio',
  artistico: 'Artístico',
};

function tipoBadgeClass(tipo) {
  if (tipo === 'espaco') return 'neg';
  if (tipo === 'artistico') return 'artistico';
  return 'res';
}

function itemsForScope(list, scope) {
  if (scope === 'artistico') return list.filter((i) => i.tipo === 'artistico');
  return list.filter((i) => i.tipo === 'espaco' || i.tipo === 'patrocinio');
}

  async function notifyEspacosDataChanged(item) {
    if (item?.tipo === 'espaco') {
      await onEspacosDataChanged?.();
    }
  }

  function summarizeItems(list) {
  let total = 0;
  let pago = 0;
  for (const item of list) {
    total += Number(item.valorTotal) || 0;
    pago += Number(item.valorPago) || 0;
  }
  return { total, pago, falta: Math.max(0, total - pago), count: list.length };
}

function isArtisticoScope(scope) {
  return scope === 'artistico';
}

const INTERACAO_TIPO_LABELS = {
  nota: 'Nota',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao: 'Reunião',
  sistema: 'Registro automático',
};

const FUNIL_ESCOPO_LABELS = {
  comercial: 'Arrecadação',
  artistico: 'Artístico',
};

function funilEscopoForLeadScope(scope) {
  return scope === 'artistico' ? 'artistico' : 'comercial';
}

function funilEscopoForItem(item) {
  return item?.tipo === 'artistico' ? 'artistico' : 'comercial';
}

const TAREFA_TIPO_LABELS = {
  presencial: 'Presencial',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao_online: 'Reunião online',
  outro: 'Outro',
};

const ETAPA_TIPO_LABELS = {
  normal: 'Etapa',
  perda: 'Perda',
  venda: 'Venda',
};

function truncateText(text, max = 42) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function shortRef(descricao, max = 28) {
  const s = String(descricao || '').trim();
  if (!s) return '—';
  const dash = s.indexOf(' — ');
  const head = dash > 0 ? s.slice(0, dash) : s;
  return truncateText(head, max);
}

function groupItemsForTable(list) {
  const map = new Map();
  for (const item of list) {
    const key = String(item.participanteId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  const tipoOrder = { patrocinio: 0, espaco: 1 };

  return [...map.values()].map((groupItems) => {
    const sorted = [...groupItems].sort((a, b) => {
      const oa = tipoOrder[a.tipo] ?? 9;
      const ob = tipoOrder[b.tipo] ?? 9;
      if (oa !== ob) return oa - ob;
      return (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR');
    });
    const valorTotal = sorted.reduce((s, i) => s + Number(i.valorTotal || 0), 0);
    const valorPago = sorted.reduce((s, i) => s + Number(i.valorPago || 0), 0);
    const valorFalta = Math.max(0, valorTotal - valorPago);
    const statuses = [...new Set(sorted.map((i) => i.status || 'neg'))];
    const tipos = [...new Set(sorted.map((i) => i.tipo))];

    return {
      items: sorted,
      merged: sorted.length > 1,
      participanteId: sorted[0].participanteId,
      participanteNome: sorted[0].participanteNome,
      tipo: sorted[0].tipo,
      tipos,
      valorTotal,
      valorPago,
      valorFalta,
      statuses,
    };
  });
}

function renderTipoBadges(tipos) {
  const list = tipos?.length ? tipos : [];
  if (!list.length) return '';
  return list
    .map((t) => `<span class="badge ${tipoBadgeClass(t)}">${TIPO_LABELS[t]}</span>`)
    .join('');
}

const ICON_PAYMENT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`;
const ICON_PERDA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5"/><path d="m22 8-5 5"/></svg>`;
const ICON_DELETE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
const ICON_ARTISTIC = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const ICON_OPEN_LEAD = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 11a4 4 0 1 0 0 8H5v6H3v-6a4 4 0 0 1 4-4z"/></svg>`;

function actionIconBtn({ action, id, title, icon, danger = false }) {
  const cls = danger ? 'icon-btn danger' : 'icon-btn';
  const label = escapeHtml(title);
  return `<button class="${cls}" type="button" data-action="${action}" data-id="${id}" title="${label}" aria-label="${label}">${icon}</button>`;
}

function leadActionIconBtn({ action, title, icon, danger = false }) {
  const cls = danger ? 'icon-btn danger tip-center' : 'icon-btn tip-center';
  const label = escapeHtml(title);
  return `<button class="${cls}" type="button" data-lead-action="${action}" data-tip="${label}" aria-label="${label}">${icon}</button>`;
}

export function initArrecadacaoModule(
  store,
  {
    onTarefaChanged,
    onNavigate,
    openTarefaEditor,
    onEspacosDataChanged,
    onOpenEspaco,
    currentUser,
    onOpenWhatsappChat,
  } = {},
) {
  let leadScope = 'comercial';

  const els = {
    summary: null,
    donut: null,
    stats: null,
    table: null,
    disponiveisSection: null,
    disponiveisSummary: null,
    disponiveisTable: null,
    btnNew: null,
    btnFunilConfig: null,
    listaView: null,
    kanbanView: null,
    modalBg: document.getElementById('arrecadacao-modal-bg'),
    modalTitle: document.getElementById('arrecadacao-modal-title'),
    modalSub: document.getElementById('arrecadacao-modal-sub'),
    participante: document.getElementById('a-participante'),
    participanteLabel: document.getElementById('a-participante-label'),
    participanteId: document.getElementById('a-participante-id'),
    status: document.getElementById('a-status'),
    statusField: document.getElementById('a-status-field'),
    statusHint: document.getElementById('a-status-hint'),
    descricao: document.getElementById('a-descricao'),
    descricaoField: document.getElementById('a-descricao-field'),
    valorTotal: document.getElementById('a-valor-total'),
    valorTotalLabel: document.getElementById('a-valor-total-label'),
    valoresRow: document.getElementById('a-valores-row'),
    valorPagoField: document.getElementById('a-valor-pago-field'),
    obsField: document.getElementById('a-obs-field'),
    valorPago: document.getElementById('a-valor-pago'),
    valorTotalHint: document.getElementById('a-valor-total-hint'),
    obs: document.getElementById('a-obs'),
    btnCancel: document.getElementById('arrecadacao-btn-cancel'),
    btnSave: document.getElementById('arrecadacao-btn-save'),
    btnDelete: document.getElementById('arrecadacao-btn-delete'),
    perdaModalBg: document.getElementById('perda-lead-modal-bg'),
    perdaModalSub: document.getElementById('perda-lead-modal-sub'),
    perdaMotivo: document.getElementById('perda-motivo'),
    perdaOutroField: document.getElementById('perda-outro-field'),
    perdaOutro: document.getElementById('perda-outro'),
    perdaBtnCancel: document.getElementById('perda-lead-btn-cancel'),
    perdaBtnSave: document.getElementById('perda-lead-btn-save'),
    pagamentoModalBg: document.getElementById('pagamento-modal-bg'),
    pagamentoModalSub: document.getElementById('pagamento-modal-sub'),
    pagamentoResumo: document.getElementById('pagamento-resumo'),
    pagamentoValor: document.getElementById('pagamento-valor'),
    pagamentoObs: document.getElementById('pagamento-obs'),
    pagamentoBtnCancel: document.getElementById('pagamento-btn-cancel'),
    pagamentoBtnSave: document.getElementById('pagamento-btn-save'),
    pagamentoHistoricoRegistro: document.getElementById('pagamento-historico-registro'),
    pagamentoHistoricoParticipante: document.getElementById('pagamento-historico-participante'),
    pagamentoHistoricoParticipanteSub: document.getElementById('pagamento-historico-participante-sub'),
    valorPagoHint: document.getElementById('a-valor-pago-hint'),
    participanteHint: document.getElementById('a-participante-hint'),
    novoParticipantePanel: document.getElementById('a-novo-participante-panel'),
    instagram: document.getElementById('a-instagram'),
    whatsapp: document.getElementById('a-whatsapp'),
    proximoContato: document.getElementById('a-proximo-contato'),
    obsContato: document.getElementById('a-obs-contato'),
    funilModalBg: document.getElementById('funil-modal-bg'),
    funilModalTitle: document.getElementById('funil-modal-title'),
    funilModalSub: document.getElementById('funil-modal-sub'),
    funilEtapasList: document.getElementById('funil-etapas-list'),
    funilNewTitulo: document.getElementById('funil-new-titulo'),
    funilBtnAdd: document.getElementById('funil-btn-add'),
    funilBtnCancel: document.getElementById('funil-btn-cancel'),
    funilBtnSave: document.getElementById('funil-btn-save'),
    leadWorkspace: document.getElementById('lead-workspace'),
    leadWorkspaceBack: document.getElementById('lead-workspace-back'),
    leadAvatar: document.getElementById('lead-avatar'),
    leadDetailTitle: document.getElementById('lead-detail-title'),
    leadDetailBadges: document.getElementById('lead-detail-badges'),
    leadDetailActions: document.getElementById('lead-detail-actions'),
    leadDealPanel: document.getElementById('lead-deal-panel'),
    leadInteracoesList: document.getElementById('lead-interacoes-list'),
    leadWhatsappInteraction: document.getElementById('lead-whatsapp-interaction'),
    leadInteracaoForm: document.getElementById('lead-interacao-form'),
    leadAnotacoesDetails: document.getElementById('lead-anotacoes-details'),
    leadTarefasDetails: document.getElementById('lead-tarefas-details'),
    leadInteracaoTipo: document.getElementById('lead-interacao-tipo'),
    leadInteracaoTexto: document.getElementById('lead-interacao-texto'),
    leadTarefaForm: document.getElementById('lead-tarefa-form'),
    leadTarefaNome: document.getElementById('lead-tarefa-nome'),
    leadTarefaData: document.getElementById('lead-tarefa-data'),
    leadTarefaHora: document.getElementById('lead-tarefa-hora'),
    leadTarefaTipo: document.getElementById('lead-tarefa-tipo'),
    leadTarefaResponsavel: document.getElementById('lead-tarefa-responsavel'),
    leadTarefasTable: document.getElementById('lead-tarefas-table'),
    leadFunilSteps: document.getElementById('lead-funil-steps'),
    leadOrigemCanal: document.getElementById('lead-origem-canal'),
    leadOrigemCampanha: document.getElementById('lead-origem-campanha'),
    leadOrigemCriativo: document.getElementById('lead-origem-criativo'),
    migrateArtisticoPanel: document.getElementById('a-migrate-artistico-panel'),
    migrateArtisticoBtn: document.getElementById('a-migrate-artistico-btn'),
  };

  let items = [];
  let espacosDisponiveis = [];
  let participantes = [];
  let funilEtapas = [];
  let funilEscopoAtual = 'comercial';
  let leadDetailTarefas = [];
  let usuarios = [];
  let loggedUser = currentUser || null;
  let marketingData = { canais: [], campanhas: [], criativos: [] };
  let leadOrigemSaving = false;
  let draftFunilEtapas = [];
  let viewMode = 'lista';
  const overviewVisible = {
    comercial: true,
    artistico: true,
  };
  let loadSeq = 0;

  function applyLeadScope(scope) {
    leadScope = PAGE_CONFIG[scope] ? scope : 'comercial';
    const cfg = PAGE_CONFIG[leadScope];
    for (const [key, id] of Object.entries(cfg.ids)) {
      els[key] = id ? document.getElementById(id) : null;
    }
    if (cfg.listOnly) {
      viewMode = 'lista';
    } else {
      viewMode = localStorage.getItem(cfg.viewModeKey) === 'kanban' ? 'kanban' : 'lista';
    }
    applyOverviewLayout(leadScope);
  }

  function funilEscopoLabel(escopo) {
    return FUNIL_ESCOPO_LABELS[escopo] || escopo;
  }

  async function loadFunilEtapasForEscopo(escopo) {
    const data = await fetchFunilEtapas({ escopo });
    funilEtapas = data.etapas || [];
    funilEscopoAtual = escopo;
    return funilEtapas;
  }

  async function ensureFunilForItem(item) {
    const escopo = funilEscopoForItem(item);
    if (escopo === funilEscopoAtual && funilEtapas.length) return funilEtapas;
    return loadFunilEtapasForEscopo(escopo);
  }

  function createLeadTipo() {
    return PAGE_CONFIG[leadScope].createTipo;
  }

  function syncAppHeaderHeight() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    document.documentElement.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
  }

  applyLeadScope('comercial');
  loadOverviewPreferences();
  applyOverviewLayout('comercial');
  applyOverviewLayout('artistico');
  syncAppHeaderHeight();
  window.addEventListener('resize', syncAppHeaderHeight);
  let draggingItemId = null;
  let kanbanCardWasDragged = false;
  let leadDetailId = null;
  let leadDetailItem = null;
  let leadDetailInteracoes = [];
  let leadSeguidoresHistorico = { historico: [], resumo: {} };
  let leadFieldEditing = null;
  let leadFieldSaving = false;
  let editId = null;
  let editTipo = null;
  let isCreateMode = false;
  let perdaLeadId = null;
  let pagamentoItemId = null;

  function renderParticipantesDatalist() {
    const datalist = document.getElementById('arrecadacao-participantes-list');
    if (!datalist) return;
    const list = [...participantes].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    );
    datalist.innerHTML = list
      .map((p) => `<option value="${escapeHtml(p.nome)}"></option>`)
      .join('');
  }

  function matchParticipanteByNome(nome) {
    const q = String(nome || '').trim().toLowerCase();
    if (!q) return null;
    return participantes.find((p) => p.nome.toLowerCase() === q) || null;
  }

  function isCadastroNovoParticipante() {
    if (!isCreateMode) return false;
    const nome = els.participante?.value.trim();
    if (!nome) return false;
    return !matchParticipanteByNome(nome);
  }

  function maskPhoneInput(el) {
    const digits = el.value.replace(/\D/g, '').slice(0, 11);
    if (!digits) {
      el.value = '';
      return;
    }
    if (digits.length <= 2) {
      el.value = `(${digits}`;
      return;
    }
    if (digits.length <= 6) {
      el.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
      return;
    }
    if (digits.length <= 10) {
      el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      return;
    }
    el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function formatPhoneDisplay(phone) {
    if (!phone) return '';
    const d = String(phone).replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }

  function formatDateBr(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = String(isoDate).slice(0, 10).split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}/${m}/${y}`;
  }

  function handleOpenWhatsappChat(participanteId, { closeLead = false } = {}) {
    const id = Number(participanteId);
    if (!Number.isInteger(id) || id < 1) return;
    const p = getParticipanteById(id);
    if (!String(p?.contatoTelefone || '').trim()) {
      alert('Cadastre um WhatsApp para este lead nos dados do lead.');
      return;
    }
    if (closeLead) closeLeadWorkspace();
    onOpenWhatsappChat?.(id);
  }

  function readParticipanteInput() {
    const nome = els.participante.value.trim();
    if (!nome) return { participanteId: null, participanteNome: '' };
    const matched = matchParticipanteByNome(nome);
    if (matched) return { participanteId: matched.id, participanteNome: matched.nome };
    return { participanteId: null, participanteNome: nome };
  }

  function syncParticipanteIdFromInput() {
    syncLeadCreateUi();
  }

  function resetNovoParticipanteFields() {
    if (els.instagram) els.instagram.value = '';
    if (els.whatsapp) els.whatsapp.value = '';
    if (els.proximoContato) els.proximoContato.value = '';
    if (els.obsContato) els.obsContato.value = '';
  }

  function etapaForStatus(status) {
    return funilEtapas.find((e) => e.status === status) || null;
  }

  function isVendaEtapaStatus(status) {
    return etapaForStatus(status)?.tipo === 'venda';
  }

  function isPerdaItem(item) {
    const etapa = etapaForStatus(item.status);
    if (etapa?.tipo === 'perda') return true;
    return item.status === 'perda';
  }

  function slugifyEtapa(text) {
    return (
      String(text || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 28) || 'etapa'
    );
  }

  function uniqueEtapaStatus(base, etapas) {
    const used = new Set(etapas.map((e) => e.status));
    let slug = slugifyEtapa(base);
    if (!used.has(slug)) return slug;
    let n = 2;
    while (used.has(`${slug}_${n}`)) n += 1;
    return `${slug}_${n}`;
  }

  /** Primeira etapa normal ativa do funil (acionamento de novos leads). */
  function acionamentoEtapa() {
    const ativas = [...funilEtapas]
      .filter((e) => e.ativo !== false && (e.tipo || 'normal') === 'normal')
      .sort((a, b) => a.ordem - b.ordem);
    if (ativas.length) return ativas[0];
    return { status: 'lead', titulo: LABELS.lead || 'Lead' };
  }

  function fillArtisticoContatoFields(item) {
    const p = item?.participanteId ? getParticipanteById(item.participanteId) : null;
    if (els.instagram) els.instagram.value = p?.instagram || '';
    if (els.whatsapp) {
      els.whatsapp.value = p?.contatoTelefone ? formatPhoneDisplay(p.contatoTelefone) : '';
    }
  }

  function syncArtisticoLeadUi(item = null) {
    els.novoParticipantePanel?.classList.remove('hidden');
    els.valorPagoField?.classList.add('hidden');
    els.descricaoField?.classList.remove('hidden');
    els.valoresRow?.classList.remove('hidden');
    els.obsField?.classList.remove('hidden');
    if (els.valorTotalLabel) els.valorTotalLabel.textContent = 'Orçamento (R$)';
    if (els.valorTotalHint) {
      els.valorTotalHint.textContent = 'Valor proposto ou em negociação para esta atração.';
    }
    if (els.participanteLabel) {
      els.participanteLabel.textContent = isCreateMode ? 'Artista / contato' : 'Artista / contato';
    }
    const panelTitle = els.novoParticipantePanel?.querySelector('.field-panel-title');
    if (panelTitle) panelTitle.textContent = 'Contato';

    if (isCreateMode) {
      const nome = els.participante.value.trim();
      const matched = matchParticipanteByNome(nome);
      els.participanteId.value = matched ? String(matched.id) : '';
      if (matched) fillArtisticoContatoFields({ participanteId: matched.id });
      else if (!nome) fillArtisticoContatoFields(null);

      if (els.participanteHint) {
        if (!nome) {
          els.participanteHint.textContent =
            'Selecione um artista cadastrado ou digite um nome novo com Instagram e WhatsApp.';
        } else if (matched) {
          els.participanteHint.textContent =
            'Artista cadastrado — confira o contato e informe a atração e o orçamento.';
        } else {
          els.participanteHint.textContent =
            'Nome novo — preencha Instagram e WhatsApp para facilitar o retorno.';
        }
      }
      const etapa = acionamentoEtapa();
      if (els.modalSub) {
        els.modalSub.textContent = nome
          ? `Lead artístico na etapa ${etapa.titulo}.`
          : `Novo lead artístico — etapa ${etapa.titulo}.`;
      }
    } else {
      fillArtisticoContatoFields(item);
      if (els.participanteHint) {
        els.participanteHint.textContent = 'Atualize contato, orçamento e status conforme a negociação.';
      }
    }
  }

  function syncLeadCreateUi() {
    if (editTipo === 'artistico' || isArtisticoScope(leadScope)) {
      syncArtisticoLeadUi(items.find((x) => x.id === editId) || null);
      return;
    }

    if (!isCreateMode) {
      els.novoParticipantePanel?.classList.add('hidden');
      els.valoresRow?.classList.remove('hidden');
      els.valorPagoField?.classList.remove('hidden');
      els.obsField?.classList.remove('hidden');
      if (els.valorTotalLabel) els.valorTotalLabel.textContent = 'Valor total (R$)';
      return;
    }

    const nome = els.participante.value.trim();
    const matched = matchParticipanteByNome(nome);
    const isNovo = Boolean(nome && !matched);

    els.novoParticipantePanel?.classList.toggle('hidden', !isNovo);
    els.valoresRow?.classList.toggle('hidden', !matched);
    els.valorPagoField?.classList.add('hidden');
    els.obsField?.classList.add('hidden');

    if (els.valorTotalLabel) {
      els.valorTotalLabel.textContent = matched ? 'Valor previsto (R$)' : 'Valor total (R$)';
    }

    els.participanteId.value = matched ? String(matched.id) : '';

    if (els.participanteHint) {
      if (!nome) {
        els.participanteHint.textContent = 'Selecione um cadastrado ou digite um nome novo.';
      } else if (matched) {
        els.participanteHint.textContent = 'Participante cadastrado. Informe o valor previsto.';
      } else {
        els.participanteHint.textContent =
          'Nome novo — preencha os dados de contato para entrar na etapa de acionamento.';
      }
    }

    if (els.valorTotalHint) {
      els.valorTotalHint.textContent = matched ? 'Valor previsto para esta oportunidade no funil.' : '';
    }

    if (els.modalSub) {
      const etapa = acionamentoEtapa();
      if (!nome) {
        els.modalSub.textContent = `Selecione um cadastrado ou cadastre um nome novo na etapa ${etapa.titulo}.`;
      } else if (matched) {
        els.modalSub.textContent = `Oportunidade para ${matched.nome} — etapa ${etapa.titulo}.`;
      } else {
        els.modalSub.textContent = `Novo participante na etapa de acionamento: ${etapa.titulo}.`;
      }
    }
  }

  function renderStatusSelectOptions(selected, selectEl = els.status) {
    if (!selectEl) return;
    const options = (funilEtapas.length ? funilEtapas : FUNIL_STATUS_ORDER.map((status) => ({
      status,
      titulo: LABELS[status],
      tipo: status === 'vend' ? 'venda' : 'normal',
      ativo: true,
      ordem: FUNIL_STATUS_ORDER.indexOf(status),
    })))
      .filter((e) => e.ativo !== false && (e.tipo || 'normal') === 'normal')
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

    selectEl.innerHTML = options
      .map(
        (e) =>
          `<option value="${escapeHtml(e.status)}">${escapeHtml(e.titulo || LABELS[e.status] || e.status)}</option>`,
      )
      .join('');
    if (selected) selectEl.value = selected;
  }

  function openModal(item = null, mode = 'edit') {
    const isCreate = mode === 'create' && !item;
    if (!isCreate && item?.id) {
      openLeadDetail(item.id, { tipo: item.tipo });
      return;
    }

    isCreateMode = isCreate;
    editId = isCreateMode ? null : (item?.id ?? null);
    if (isCreateMode && isArtisticoScope(leadScope)) {
      editTipo = 'artistico';
    } else {
      editTipo = item?.tipo ?? (isCreateMode ? createLeadTipo() : null);
    }
    const isEspaco = editTipo === 'espaco';
    const isArtistico = editTipo === 'artistico';

    const etapaAcionamento = acionamentoEtapa();

    els.modalTitle.textContent = isCreate
      ? 'Novo lead'
      : isEspaco
        ? 'Arrecadação — espaço'
        : isArtistico
          ? 'Artístico'
          : 'Arrecadação — patrocínio';
    els.modalSub.textContent = isCreate
      ? `Cadastre um participante na etapa de acionamento: ${etapaAcionamento.titulo}.`
      : item
        ? `${TIPO_LABELS[item.tipo]} · ${item.participanteNome}`
        : '';

    if (els.participanteLabel) {
      els.participanteLabel.textContent = isArtistico
        ? 'Artista / contato'
        : isCreate
          ? 'Participante'
          : 'Participante / Patrocinador';
    }

    els.participante.value = item?.participanteNome || '';
    els.participanteId.value = item?.participanteId ? String(item.participanteId) : '';
    els.participante.disabled = isEspaco;
    renderStatusSelectOptions(item?.status || (isCreate ? etapaAcionamento.status : 'neg'));
    els.status.disabled = isEspaco || isCreate;
    els.statusField?.classList.toggle('hidden', isCreate);
    els.statusHint.textContent = isEspaco
      ? 'Status sincronizado automaticamente a partir do espaço.'
      : isCreate
        ? `Entra automaticamente na 1ª etapa do funil (${etapaAcionamento.titulo}).`
        : '';
    els.descricao.value =
      item?.descricao || (isCreate && !isArtistico ? etapaAcionamento.titulo : '');
    els.descricaoField.classList.toggle('hidden', isEspaco || (isCreate && !isArtistico));
    if (isArtistico) {
      if (els.descricao) els.descricao.placeholder = 'Ex.: Banda XYZ — show de abertura';
      const descLabel = els.descricaoField?.querySelector('label');
      if (descLabel) descLabel.textContent = 'Atração';
    }
    els.valorTotal.value = formatValorInput(item?.valorTotal ?? 0);
    els.valorPago.value = formatValorInput(item?.valorPago ?? 0);
    els.valorTotal.disabled = false;
    els.valorPago.disabled = !isCreate;
    els.valorPago.readOnly = !isCreate;
    els.valorTotalHint.textContent = isEspaco
      ? 'Pode ajustar o valor acordado; alterações também atualizam o espaço vinculado.'
      : '';
    if (els.valorPagoHint) {
      els.valorPagoHint.textContent = 'Atualizado pelos registros de pagamento.';
    }
    els.obs.value = item?.obs || '';
    if (isArtistico) {
      if (isCreate) resetNovoParticipanteFields();
      syncArtisticoLeadUi(item);
    } else {
      resetNovoParticipanteFields();
      if (isCreate) syncLeadCreateUi();
    }

    els.migrateArtisticoPanel?.classList.toggle(
      'hidden',
      isCreate || isArtistico || isEspaco || isArtisticoScope(leadScope),
    );

    els.btnDelete?.classList.toggle('hidden', isCreate || !isArtistico || isEspaco);

    els.modalBg.classList.add('open');
    (isEspaco ? els.valorTotal : els.participante).focus();
  }

  function closeModal() {
    els.migrateArtisticoPanel?.classList.add('hidden');
    els.btnDelete?.classList.add('hidden');
    els.modalBg.classList.remove('open');
    els.participante.disabled = false;
    els.status.disabled = false;
    els.statusField?.classList.remove('hidden');
    els.descricaoField?.classList.remove('hidden');
    if (els.participanteLabel) els.participanteLabel.textContent = 'Participante / Patrocinador';
    if (els.valorTotalLabel) els.valorTotalLabel.textContent = 'Valor total (R$)';
    els.valoresRow?.classList.remove('hidden');
    els.valorPagoField?.classList.remove('hidden');
    els.obsField?.classList.remove('hidden');
    els.novoParticipantePanel?.classList.add('hidden');
    els.valorTotal.disabled = false;
    els.valorPago.disabled = false;
    els.valorPago.readOnly = false;
    resetNovoParticipanteFields();
    editId = null;
    editTipo = null;
    isCreateMode = false;
  }

  function canRegisterPerdaLead(item) {
    if (isPerdaItem(item)) return false;
    return item.tipo === 'patrocinio' || item.tipo === 'artistico' || item.status === 'lead';
  }

  function resolveLeadItem(id) {
    const numId = Number(id);
    return (
      items.find((x) => x.id === numId) ||
      (leadDetailItem?.id === numId ? leadDetailItem : null)
    );
  }

  async function ensureLeadItem(id) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) return null;

    const cached = resolveLeadItem(numId);
    if (cached) return cached;

    try {
      const data = await fetchArrecadacaoById(numId);
      const item = data?.item;
      if (!item) return null;

      const scope = item.tipo === 'artistico' ? 'artistico' : 'comercial';
      if (scope === leadScope && !items.some((x) => x.id === numId)) {
        items = [...items, item];
      }
      return item;
    } catch (_) {
      return null;
    }
  }

  function canMigrateToArtistico(item) {
    return item?.tipo === 'patrocinio' && !isArtisticoScope(leadScope);
  }

  function canMigrateBadge(item) {
    return item?.tipo === 'patrocinio';
  }

  async function deleteArtisticoLead(itemOrId) {
    const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
    const item =
      (typeof itemOrId === 'object' ? itemOrId : null) || items.find((x) => x.id === id);
    if (!id || !item || item.tipo !== 'artistico') return;

    const label = item.participanteNome || item.descricao || 'este lead';
    if (
      !confirm(
        `Excluir o lead artístico "${label}"? Tarefas e histórico vinculados serão removidos. Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    try {
      await deleteArrecadacao(id);
      closeModal();
      closeLeadWorkspace();
      await loadArrecadacao();
      onTarefaChanged?.();
    } catch (err) {
      alert(err.message);
    }
  }

  async function migrateToArtistico(id) {
    const item = resolveLeadItem(id);
    if (!item) {
      alert('Lead não encontrado. Feche o workspace e abra o lead novamente.');
      return;
    }
    if (item.tipo !== 'patrocinio') {
      alert('Só leads de patrocínio podem ser movidos para Artístico.');
      return;
    }

    const ok = confirm(
      `Mover "${item.participanteNome}" para o Artístico?\n\nO lead sairá da arrecadação comercial e passará a aparecer só no menu Artístico.`,
    );
    if (!ok) return;

    try {
      const { item: updated } = await migrateArrecadacaoToArtistico(id);
      if (!updated || updated.tipo !== 'artistico') {
        throw new Error(
          'A migração não foi confirmada pela API. Reinicie o servidor (npm run dev:api) e tente de novo.',
        );
      }

      closeModal();
      closeLeadWorkspace();
      leadDetailItem = updated;
      await switchLeadScope('artistico', { navigate: true });
      await openLeadDetail(updated.id, { tipo: 'artistico' });
    } catch (err) {
      alert(err.message);
    }
  }

  function renderItemActions(item) {
    const artistico = item.tipo === 'artistico';
    const openAction = artistico ? 'abrir-lead' : 'edit';
    return `
      ${actionIconBtn({
        action: openAction,
        id: item.id,
        title: 'Abrir lead',
        icon: ICON_OPEN_LEAD,
      })}
      ${
        canMigrateToArtistico(item)
          ? actionIconBtn({
              action: 'migrar-artistico',
              id: item.id,
              title: 'Mover para Artístico',
              icon: ICON_ARTISTIC,
            })
          : ''
      }
      ${
        artistico
          ? actionIconBtn({
              action: 'excluir',
              id: item.id,
              title: 'Excluir lead',
              icon: ICON_DELETE,
              danger: true,
            })
          : actionIconBtn({ action: 'pagamento', id: item.id, title: 'Registrar pagamento', icon: ICON_PAYMENT })
      }
      ${canRegisterPerdaLead(item) ? actionIconBtn({ action: 'perda-lead', id: item.id, title: 'Perda do lead', icon: ICON_PERDA, danger: true }) : ''}
    `;
  }

  function openPerdaLeadModal(item) {
    perdaLeadId = item.id;
    els.perdaModalSub.textContent = `${TIPO_LABELS[item.tipo]} · ${item.participanteNome}`;
    els.perdaMotivo.value = '';
    els.perdaOutro.value = '';
    els.perdaOutroField.classList.add('hidden');
    els.perdaModalBg.classList.add('open');
    els.perdaMotivo.focus();
  }

  function closePerdaLeadModal() {
    els.perdaModalBg.classList.remove('open');
    perdaLeadId = null;
    els.perdaMotivo.value = '';
    els.perdaOutro.value = '';
    els.perdaOutroField.classList.add('hidden');
  }

  function syncPerdaOutroField() {
    const isOutro = els.perdaMotivo.value === 'outro';
    els.perdaOutroField.classList.toggle('hidden', !isOutro);
    if (!isOutro) els.perdaOutro.value = '';
  }

  async function confirmPerdaLead() {
    if (!perdaLeadId) return;
    const motivo = els.perdaMotivo.value;
    if (!motivo) {
      alert('Selecione o motivo da perda do lead.');
      return;
    }
    const motivoOutro = els.perdaOutro.value.trim();
    if (motivo === 'outro' && !motivoOutro) {
      alert('Descreva o motivo da perda.');
      return;
    }

    const item = items.find((x) => x.id === perdaLeadId);
    if (!item) return;

    els.perdaBtnSave.disabled = true;
    els.perdaBtnSave.textContent = 'Salvando…';
    try {
      const perdaItem = items.find((x) => x.id === perdaLeadId);
      await registerPerdaLead(perdaLeadId, { motivo, motivoOutro });
      closePerdaLeadModal();
      if (editId === perdaLeadId) closeModal();
      await loadArrecadacao();
      await notifyEspacosDataChanged(perdaItem);
    } catch (err) {
      alert(err.message);
    } finally {
      els.perdaBtnSave.disabled = false;
      els.perdaBtnSave.textContent = 'Confirmar perda';
    }
  }

  function readForm() {
    const participante = readParticipanteInput();
    const etapaAcionamento = acionamentoEtapa();
    const isArtistico = editTipo === 'artistico' || isArtisticoScope(leadScope);
    const form = {
      ...participante,
      descricao: isArtistico
        ? els.descricao.value.trim() || 'Artístico'
        : isCreateMode
          ? etapaAcionamento.titulo
          : els.descricao.value.trim() || 'Patrocínio',
      status: isCreateMode ? etapaAcionamento.status : els.status.value,
      valorTotal: parseValor(els.valorTotal.value) ?? 0,
      obs: els.obs.value.trim(),
    };
    if (isArtistico) {
      form.participanteInstagram = els.instagram?.value.trim() || '';
      form.participanteWhatsapp = els.whatsapp?.value.replace(/\D/g, '') || '';
    }
    if (isCreateMode) {
      form.valorPago = 0;
      if (isArtistico && isCadastroNovoParticipante()) {
        form.novoParticipante = true;
        form.proximoContato = els.proximoContato?.value || '';
        form.obsProximoContato = els.obsContato?.value.trim() || '';
      } else if (!isArtistico && isCadastroNovoParticipante()) {
        form.novoParticipante = true;
        form.participanteInstagram = els.instagram?.value.trim() || '';
        form.participanteWhatsapp = els.whatsapp?.value.replace(/\D/g, '') || '';
        form.proximoContato = els.proximoContato?.value || '';
        form.obsProximoContato = els.obsContato?.value.trim() || '';
      }
    }
    return form;
  }

  function renderPagamentoHistoricoTable(
    tbody,
    pagamentos,
    { showReferencia = false, allowDelete = false, arrecadacaoId = null } = {},
  ) {
    if (!tbody) return;
    const actionCol = allowDelete ? 1 : 0;
    const cols = (showReferencia ? 4 : 3) + actionCol;
    if (!pagamentos.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}" class="cell-empty">Nenhum pagamento registrado.</td></tr>`;
      return;
    }
    tbody.innerHTML = pagamentos
      .map((p) => {
        const ref = showReferencia
          ? `<td class="cell-ref" title="${escapeHtml(p.arrecadacaoDescricao || '')}">${escapeHtml(p.arrecadacaoDescricao || '—')}</td>`
          : '';
        const canDelete =
          allowDelete && arrecadacaoId != null && Number(p.arrecadacaoId) === Number(arrecadacaoId);
        const actions = allowDelete
          ? `<td class="col-acao">${canDelete ? actionIconBtn({
              action: 'excluir-pagamento',
              id: p.id,
              title: 'Remover pagamento',
              icon: ICON_DELETE,
              danger: true,
            }) : ''}</td>`
          : '';
        const obs = p.obs ? escapeHtml(p.obs) : '—';
        return `
        <tr data-pagamento-id="${p.id}">
          <td class="col-data">${fmtDate(p.registradoEm)}</td>
          ${ref}
          <td class="col-valor cell-money">${fmtMoney(p.valor)}</td>
          <td class="col-obs ${p.obs ? 'cell-muted' : 'cell-empty'}" title="${p.obs ? escapeHtml(p.obs) : ''}">${obs}</td>
          ${actions}
        </tr>
      `;
      })
      .join('');

    if (allowDelete && arrecadacaoId != null) {
      tbody.querySelectorAll('[data-action="excluir-pagamento"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pagamentoId = Number(btn.dataset.id);
          if (pagamentoId) removePagamento(pagamentoId);
        });
      });
    }
  }

  function renderPagamentoResumo(item) {
    if (!els.pagamentoResumo) return;
    const falta = Math.max(0, item.valorTotal - item.valorPago);
    const faltaClass = falta > 0 ? 'pagamento-resumo-valor--falta' : 'pagamento-resumo-valor--quitado';
    const faltaLabel = falta > 0 ? fmtMoney(falta) : 'Quitado';
    els.pagamentoResumo.innerHTML = `
      <div class="pagamento-resumo-item">
        <span class="pagamento-resumo-label">Total</span>
        <strong class="pagamento-resumo-valor">${fmtMoney(item.valorTotal)}</strong>
      </div>
      <div class="pagamento-resumo-item">
        <span class="pagamento-resumo-label">Já pago</span>
        <strong class="pagamento-resumo-valor pagamento-resumo-valor--pago">${fmtMoney(item.valorPago)}</strong>
      </div>
      <div class="pagamento-resumo-item">
        <span class="pagamento-resumo-label">Falta</span>
        <strong class="pagamento-resumo-valor ${faltaClass}">${faltaLabel}</strong>
      </div>
    `;
  }

  async function loadPagamentoHistorico(item) {
    const [registro, participante] = await Promise.all([
      fetchPagamentosArrecadacao(item.id),
      fetchPagamentosParticipante(item.participanteId),
    ]);
    renderPagamentoHistoricoTable(els.pagamentoHistoricoRegistro, registro.pagamentos || [], {
      allowDelete: true,
      arrecadacaoId: item.id,
    });
    renderPagamentoHistoricoTable(els.pagamentoHistoricoParticipante, participante.pagamentos || [], {
      showReferencia: true,
    });
    if (els.pagamentoHistoricoParticipanteSub) {
      els.pagamentoHistoricoParticipanteSub.textContent = item.participanteNome;
    }
  }

  async function openPagamentoModal(item) {
    pagamentoItemId = item.id;
    els.pagamentoModalSub.textContent = `${TIPO_LABELS[item.tipo]} · ${item.participanteNome} · ${item.descricao || '—'}`;
    els.pagamentoValor.value = '';
    els.pagamentoObs.value = '';
    renderPagamentoResumo(item);
    els.pagamentoModalBg.classList.add('open');
    try {
      await loadPagamentoHistorico(item);
    } catch (err) {
      alert(err.message);
    }
    els.pagamentoValor.focus();
  }

  function closePagamentoModal() {
    els.pagamentoModalBg.classList.remove('open');
    pagamentoItemId = null;
    els.pagamentoValor.value = '';
    els.pagamentoObs.value = '';
  }

  async function removePagamento(pagamentoId) {
    if (!pagamentoItemId) return;
    if (!confirm('Remover este registro de pagamento? O valor pago será recalculado.')) return;

    try {
      const result = await deletePagamento(pagamentoItemId, pagamentoId);
      await loadArrecadacao();
      const updated = items.find((x) => x.id === pagamentoItemId) || result.item;
      if (updated) {
        renderPagamentoResumo(updated);
        await loadPagamentoHistorico(updated);
        if (editId === pagamentoItemId) {
          els.valorPago.value = formatValorInput(updated.valorPago);
        }
        await notifyEspacosDataChanged(updated);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function confirmPagamento() {
    if (!pagamentoItemId) return;
    const valor = parseValor(els.pagamentoValor.value);
    if (!valor || valor <= 0) {
      alert('Informe o valor recebido.');
      return;
    }

    const item = items.find((x) => x.id === pagamentoItemId);
    if (!item) return;

    els.pagamentoBtnSave.disabled = true;
    els.pagamentoBtnSave.textContent = 'Registrando…';
    try {
      const result = await registerPagamento(pagamentoItemId, {
        valor,
        obs: els.pagamentoObs.value.trim(),
      });
      els.pagamentoValor.value = '';
      els.pagamentoObs.value = '';
      await loadArrecadacao();
      const updated = items.find((x) => x.id === pagamentoItemId) || result.item;
      if (updated) {
        renderPagamentoResumo(updated);
        await loadPagamentoHistorico(updated);
        if (editId === pagamentoItemId) {
          els.valorPago.value = formatValorInput(updated.valorPago);
        }
        await notifyEspacosDataChanged(updated);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      els.pagamentoBtnSave.disabled = false;
      els.pagamentoBtnSave.textContent = 'Registrar pagamento';
    }
  }

  function renderDonut(resumo) {
    if (!els.donut) return;
    const total = Number(resumo.total) || 0;
    const pago = Number(resumo.pago) || 0;
    const falta = Math.max(0, total - pago);
    const pct = total > 0 ? Math.min(100, (pago / total) * 100) : 0;
    const r = 38;
    const c = 2 * Math.PI * r;
    const pagoLen = (pct / 100) * c;
    const pctLabel = fmtPercent(pago, total) || '0%';

    els.donut.innerHTML = `
      <div class="donut-chart" role="img" aria-label="${pctLabel} do total acordado já foi pago">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="donut-track" cx="50" cy="50" r="${r}" />
          <circle
            class="donut-fill"
            cx="50"
            cy="50"
            r="${r}"
            stroke-dasharray="${pagoLen} ${c - pagoLen}"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div class="donut-center">
          <div class="donut-pct">${pctLabel}</div>
          <div class="donut-lbl">pago</div>
        </div>
      </div>
      <div class="donut-legend">
        <div class="donut-legend-item">
          <span class="dot" style="background:#5dcaa5"></span>
          <span>Pago <strong>${fmtMoney(pago)}</strong></span>
        </div>
        <div class="donut-legend-item">
          <span class="dot" style="background:#fac775"></span>
          <span>Falta <strong>${fmtMoney(falta)}</strong></span>
        </div>
        <div class="donut-legend-item cell-muted">
          Total acordado ${fmtMoney(total)}
        </div>
      </div>
    `;
  }

  function renderArtisticoStats(list) {
    if (!els.stats) return;
    const orcamento = list.reduce((s, i) => s + (Number(i.valorTotal) || 0), 0);
    const emAndamento = list.filter((i) => !isPerdaItem(i)).length;
    els.stats.innerHTML = `
      <div class="stat">
        <div class="lbl">Leads</div>
        <div class="val">${list.length}</div>
      </div>
      <div class="stat">
        <div class="lbl">Orçamentos</div>
        <div class="val">${fmtMoney(orcamento)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Em andamento</div>
        <div class="val">${emAndamento}</div>
      </div>
    `;
  }

  function renderStats(resumo) {
    if (isArtisticoScope(leadScope)) {
      renderArtisticoStats(items);
      return;
    }
    renderDonut(resumo);
    if (!els.stats) return;
    els.stats.innerHTML = `
      <div class="stat">
        <div class="lbl">Total acordado</div>
        <div class="val">${fmtMoney(resumo.total)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Já pago</div>
        <div class="val" style="color:#5dcaa5">${fmtMoney(resumo.pago)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Falta pagar</div>
        <div class="val" style="color:#fac775">${fmtMoney(resumo.falta)}</div>
      </div>
      <div class="stat">
        <div class="lbl">Registros</div>
        <div class="val">${resumo.count}</div>
      </div>
    `;
  }

  function etapaLabel(status) {
    const etapa = funilEtapas.find((e) => e.status === status);
    return etapa?.titulo || LABELS[status] || status;
  }

  function activeFunilEtapas() {
    return [...funilEtapas].filter((e) => e.ativo).sort((a, b) => a.ordem - b.ordem);
  }

  function loadOverviewPreferences() {
    overviewVisible.comercial = localStorage.getItem(PAGE_CONFIG.comercial.overviewKey) !== '0';
    overviewVisible.artistico = localStorage.getItem(PAGE_CONFIG.artistico.overviewKey) !== '0';
  }

  function applyOverviewLayout(scope = leadScope) {
    const cfg = PAGE_CONFIG[scope];
    if (!cfg?.viewRootId) return;
    const root = document.getElementById(cfg.viewRootId);
    if (!root) return;

    if (cfg.overviewKey) {
      const visible = overviewVisible[scope] ?? true;
      root.classList.toggle('page--overview-hidden', !visible);
      const toggleId =
        scope === 'artistico' ? 'btn-artistico-toggle-overview' : 'btn-arrecadacao-toggle-overview';
      const toggleBtn = document.getElementById(toggleId);
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
        toggleBtn.textContent = visible ? 'Ocultar resumo' : 'Mostrar resumo';
      }
    }

    if (scope === 'comercial') {
      root.classList.toggle('page--kanban', viewMode === 'kanban');
    }
  }

  function applyArrecadacaoLayout() {
    applyOverviewLayout('comercial');
  }

  function setOverviewVisible(visible, scope = leadScope) {
    const key = PAGE_CONFIG[scope]?.overviewKey;
    if (!key) return;
    overviewVisible[scope] = visible;
    localStorage.setItem(key, visible ? '1' : '0');
    applyOverviewLayout(scope);
  }

  function toggleOverviewVisible(scope = leadScope) {
    setOverviewVisible(!overviewVisible[scope], scope);
  }

  function setViewMode(mode) {
    if (isArtisticoScope(leadScope)) {
      viewMode = 'lista';
    } else {
      viewMode = mode === 'kanban' ? 'kanban' : 'lista';
      localStorage.setItem(PAGE_CONFIG[leadScope].viewModeKey, viewMode);
    }

    document.querySelectorAll(`[data-arr-scope="${leadScope}"][data-arr-view]`).forEach((btn) => {
      const active = btn.dataset.arrView === viewMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    els.listaView?.classList.toggle('hidden', viewMode !== 'lista');
    els.kanbanView?.classList.toggle('hidden', viewMode !== 'kanban');
    if (els.kanbanView) els.kanbanView.hidden = viewMode !== 'kanban';

    applyArrecadacaoLayout();

    if (viewMode === 'kanban') renderKanban();
    else renderTable();

    if (viewMode === 'lista') renderDisponiveisTable();
  }

  function renderKanbanGroupCard(group) {
    const primary = group.items[0];
    const falta = group.valorFalta;
    const quitado =
      falta <= 0 && group.items.every((item) => isVendaEtapaStatus(item.status));
    const faltaHtml = quitado
      ? '<span class="arr-valor-quitado">Quitado</span>'
      : falta > 0
        ? `<span class="arr-valor-falta">Falta ${fmtMoney(falta)}</span>`
        : '';

    const refsHtml = group.merged
      ? `<div class="arr-refs-inline arr-kanban-refs" title="${escapeHtml(group.items.map((i) => i.descricao).filter(Boolean).join('\n'))}">${group.items
          .map((item, idx) => {
            const label = shortRef(item.descricao, 22);
            const sep = idx > 0 ? '<span class="arr-ref-sep" aria-hidden="true">·</span>' : '';
            return `${sep}<button type="button" class="arr-ref-chip" data-id="${item.id}" title="${escapeHtml(item.descricao || '')}">${escapeHtml(label)}</button>`;
          })
          .join('')}</div>`
      : `<div class="arr-kanban-card-ref" title="${escapeHtml(primary.descricao || '')}">${escapeHtml(shortRef(primary.descricao, 48))}</div>`;

    const actionsHtml = group.merged
      ? `<div class="arr-kanban-actions-merged">${group.items
          .map(
            (item) =>
              `<div class="arr-kanban-actions-item row-actions-icons">${renderItemActions(item)}</div>`,
          )
          .join('')}</div>`
      : `<div class="arr-kanban-card-actions row-actions-icons">${renderItemActions(primary)}</div>`;

    const groupIds = group.items.map((item) => item.id).join(',');

    return `
      <article class="arr-kanban-card${group.merged ? ' arr-kanban-card--grouped' : ''}" draggable="true" data-id="${primary.id}" data-group-ids="${groupIds}">
        <div class="arr-kanban-card-head">
          <strong title="${escapeHtml(group.participanteNome)}">${escapeHtml(truncateText(group.participanteNome, 28))}</strong>
          ${renderTipoBadges(group.tipos || [group.tipo])}
        </div>
        ${refsHtml}
        <div class="arr-kanban-card-valores">
          <span>${fmtMoney(group.valorTotal)}</span>
          ${faltaHtml}
        </div>
        ${actionsHtml}
      </article>`;
  }

  function getParticipanteById(id) {
    return participantes.find((p) => p.id === id) || null;
  }

  function formatInstagram(ig) {
    if (!ig) return '—';
    return ig.startsWith('@') ? ig : `@${ig}`;
  }

  function instagramProfileUrl(ig) {
    const handle = String(ig || '')
      .trim()
      .replace(/^@/, '')
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/\/.*$/, '');
    if (!handle) return '';
    return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  }

  function hasParticipanteInstagram(p) {
    return Boolean(
      String(p?.instagram || '')
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/.*$/, '')
        .split('/')[0],
    );
  }

  async function ensureTiposComercioDatalist() {
    try {
      const data = await fetchTiposComercio();
      store?.setTiposComercio?.(data.tipos || []);
    } catch (_) {
      store?.setTiposComercio?.([]);
    }
    const datalist = document.getElementById('tipos-comercio');
    if (!datalist) return;
    const tipos = [...(store?.tiposComercio || [])].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
    );
    datalist.innerHTML = tipos.map((t) => `<option value="${escapeHtml(t)}">`).join('');
  }

  function participantInitials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatSeguidores(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('pt-BR');
  }

  function buildSeguidoresInteracaoText(prev, next) {
    if (prev === next) return '';
    if (prev == null && next != null) {
      return `Seguidores definidos em ${formatSeguidores(next)}.`;
    }
    if (prev != null && next == null) {
      return `Seguidores removidos (antes: ${formatSeguidores(prev)}).`;
    }
    return `Seguidores atualizados de ${formatSeguidores(prev)} para ${formatSeguidores(next)}.`;
  }

  function formatVariacaoSeguidores(v) {
    if (v == null || v === 0) return '0';
    const prefix = v > 0 ? '+' : '−';
    return `${prefix}${formatSeguidores(Math.abs(v))}`;
  }

  async function loadSeguidoresHistorico(participanteId) {
    if (!participanteId) {
      leadSeguidoresHistorico = { historico: [], resumo: {} };
      return;
    }
    try {
      leadSeguidoresHistorico = await fetchSeguidoresHistorico(participanteId);
    } catch (_) {
      leadSeguidoresHistorico = { historico: [], resumo: {} };
    }
  }

  function renderSeguidoresHistoricoBlock(item) {
    const p = getParticipanteById(item.participanteId);
    if (!item.participanteId || !hasParticipanteInstagram(p)) return '';

    const historico = leadSeguidoresHistorico.historico || [];
    const resumo = leadSeguidoresHistorico.resumo || {};
    if (!historico.length) return '';

    const trendClass = {
      crescendo: 'lw-seguidores-trend--up',
      em_queda: 'lw-seguidores-trend--down',
      estavel: 'lw-seguidores-trend--stable',
      indeterminado: 'lw-seguidores-trend--neutral',
    }[resumo.tendencia || 'indeterminado'];

    const trendLabels = {
      crescendo: 'Perfil em crescimento',
      em_queda: 'Perfil em queda',
      estavel: 'Sem variação recente',
      indeterminado: 'Baseline registrado — edite para acompanhar a evolução',
    };

    let trendDetail = '';
    if (resumo.variacaoTotal != null && resumo.variacaoTotal !== 0) {
      trendDetail = ` (${formatVariacaoSeguidores(resumo.variacaoTotal)} desde o início)`;
    } else if (resumo.seguidoresAtual != null) {
      trendDetail = ` · atual: ${formatSeguidores(resumo.seguidoresAtual)}`;
    }

    const rows = historico
      .slice(0, 10)
      .map((h) => {
        const de = h.seguidoresAnterior != null ? formatSeguidores(h.seguidoresAnterior) : '—';
        const para = h.seguidores != null ? formatSeguidores(h.seguidores) : '—';
        const varClass =
          h.variacao > 0 ? 'lw-seguidores-hist-var--up' : h.variacao < 0 ? 'lw-seguidores-hist-var--down' : 'lw-seguidores-hist-var--neutral';
        const varLabel =
          h.variacao != null
            ? formatVariacaoSeguidores(h.variacao)
            : h.seguidoresAnterior == null
              ? 'início'
              : '—';
        return `
          <li class="lw-seguidores-hist-item">
            <time class="cell-muted">${fmtDate(h.registradoEm)}</time>
            <span class="lw-seguidores-hist-valores">${de} → ${para}</span>
            <span class="lw-seguidores-hist-var ${varClass}">${varLabel}</span>
          </li>`;
      })
      .join('');

    return `
      <section class="lw-seguidores-historico" aria-label="Histórico de seguidores no Instagram">
        <h3 class="lw-seguidores-historico-title">Evolução no Instagram</h3>
        <p class="lw-seguidores-trend ${trendClass}">
          ${escapeHtml(trendLabels[resumo.tendencia] || trendLabels.indeterminado)}${escapeHtml(trendDetail)}
        </p>
        <ul class="lw-seguidores-historico-list">${rows}</ul>
      </section>`;
  }

  function cancelLeadFieldEdit() {
    leadFieldEditing = null;
  }

  function leadFieldDisplayValue(field, item, p) {
    switch (field) {
      case 'participante':
        return item.participanteNome || '—';
      case 'contatoNome':
        return p?.contatoNome?.trim() || '—';
      case 'instagram':
        return p?.instagram ? formatInstagram(p.instagram) : '—';
      case 'seguidores':
        return formatSeguidores(p?.seguidores);
      case 'tipoComercio':
        return item.espacoTipo?.trim() || '—';
      case 'whatsapp':
        return p?.contatoTelefone ? formatPhoneDisplay(p.contatoTelefone) : '—';
      case 'status':
        return etapaLabel(item.status);
      case 'descricao':
        return item.descricao || '—';
      case 'valorTotal':
        return fmtMoney(item.valorTotal);
      case 'obs':
        return item.obs?.trim() || '—';
      default:
        return '—';
    }
  }

  function leadFieldCanEdit(field, item) {
    const p = getParticipanteById(item.participanteId);
    const isEspaco = item.tipo === 'espaco';
    if (isEspaco && (field === 'status' || field === 'descricao')) {
      return false;
    }
    if (field === 'contatoNome' && !item.participanteId) {
      return false;
    }
    if (field === 'seguidores' && !hasParticipanteInstagram(p)) {
      return false;
    }
    if (field === 'tipoComercio') {
      return item.tipo === 'espaco' && Boolean(item.espacoId);
    }
    return true;
  }

  function leadFieldLabel(field, item) {
    const isArtistico = item.tipo === 'artistico';
    const map = {
      participante: isArtistico ? 'Artista / lead' : 'Nome do lead',
      contatoNome: 'Nome do contato',
      instagram: 'Instagram',
      seguidores: 'Seguidores',
      tipoComercio: 'Tipo de comércio',
      whatsapp: 'WhatsApp',
      status: 'Status',
      descricao: isArtistico ? 'Atração' : 'Referência',
      valorTotal: isArtistico ? 'Orçamento' : 'Valor total',
      obs: 'Observações',
    };
    return map[field] || field;
  }

  function leadFieldExternalLink(field, p) {
    if (field === 'instagram') {
      const url = instagramProfileUrl(p?.instagram);
      return url || '';
    }
    return '';
  }

  function leadFieldExtButton(field, p, display) {
    const extUrl = leadFieldExternalLink(field, p);
    if (extUrl && display !== '—') {
      return `<a href="${extUrl}" class="lw-field-ext" target="_blank" rel="noopener noreferrer" title="Abrir em nova janela" aria-label="Abrir em nova janela" onclick="event.stopPropagation()">↗</a>`;
    }
    return '';
  }

  function renderLeadWhatsappValue(item, p, display) {
    if (display === '—' || !item?.participanteId || !String(p?.contatoTelefone || '').trim()) {
      return `<span>${escapeHtml(display)}</span>`;
    }
    return renderWhatsappPhoneButton({
      participanteId: item.participanteId,
      phone: p.contatoTelefone,
      className: 'tbtn linkish wa-phone-btn lw-phone-btn',
    });
  }

  function renderLeadFieldRow(field, item, p) {
    const canEdit = leadFieldCanEdit(field, item);
    const display = leadFieldDisplayValue(field, item, p);
    const extUrl = leadFieldExternalLink(field, p);
    const extBtn = leadFieldExtButton(field, p, display);
    const isWhatsapp = field === 'whatsapp';

    if (isWhatsapp) {
      const phoneHtml = renderLeadWhatsappValue(item, p, display);
      if (!canEdit) {
        return `
        <div class="lw-info-row" data-lw-row="${field}">
          <dt>${escapeHtml(leadFieldLabel(field, item))}</dt>
          <dd class="lw-field-cell lw-field-cell--static">${phoneHtml}</dd>
        </div>`;
      }
      return `
        <div class="lw-info-row" data-lw-row="${field}">
          <dt>${escapeHtml(leadFieldLabel(field, item))}</dt>
          <dd class="lw-field-cell lw-field-cell--whatsapp">
            ${phoneHtml}
            <button type="button" class="lw-field-btn lw-field-btn--compact" data-lw-field="${field}" title="Editar WhatsApp">Editar</button>
          </dd>
        </div>`;
    }

    if (!canEdit) {
      const valueHtml =
        extUrl && display !== '—'
          ? `<a href="${extUrl}" class="lw-ext-link" target="_blank" rel="noopener noreferrer">${escapeHtml(display)}</a>`
          : `<span>${escapeHtml(display)}</span>`;
      return `
        <div class="lw-info-row" data-lw-row="${field}">
          <dt>${escapeHtml(leadFieldLabel(field, item))}</dt>
          <dd class="lw-field-cell lw-field-cell--static">
            ${valueHtml}
            ${extBtn}
          </dd>
        </div>`;
    }

    return `
      <div class="lw-info-row" data-lw-row="${field}">
        <dt>${escapeHtml(leadFieldLabel(field, item))}</dt>
        <dd class="lw-field-cell">
          <button type="button" class="lw-field-btn" data-lw-field="${field}" title="Clique para editar">
            ${escapeHtml(display)}
          </button>
          ${extBtn}
        </dd>
      </div>`;
  }

  function findRelatedLeads(item) {
    if (!item?.participanteId || item.tipo === 'artistico') return [];
    return items.filter(
      (x) =>
        x.participanteId === item.participanteId && x.id !== item.id && x.tipo !== 'artistico',
    );
  }

  function renderLeadVinculosBlock(item) {
    const related = findRelatedLeads(item);
    if (!related.length) return '';

    const rows = related
      .map((r) => {
        const label =
          r.tipo === 'espaco'
            ? shortRef(r.descricao, 56)
            : r.descricao && r.descricao !== 'Patrocínio'
              ? `${TIPO_LABELS[r.tipo]} · ${r.descricao}`
              : TIPO_LABELS[r.tipo];
        const mapBtn =
          r.espacoId && (r.espacoNumero != null || onOpenEspaco)
            ? `<button type="button" class="lw-vinculo-map tip-center" data-lw-espaco-id="${r.espacoId}" data-lw-espaco-numero="${r.espacoNumero ?? ''}" data-lw-espaco-grupo="${r.espacoGrupoSlug || ''}" data-tip="Ver no mapa de espaços" aria-label="Ver no mapa de espaços">Mapa</button>`
            : '';
        return `<li class="lw-vinculo-item">
          <button type="button" class="lw-vinculo-btn" data-lw-vinculo-id="${r.id}">
            <span class="badge ${tipoBadgeClass(r.tipo)}">${TIPO_LABELS[r.tipo]}</span>
            <span class="lw-vinculo-label">${escapeHtml(label)}</span>
            <span class="badge ${r.status}">${escapeHtml(etapaLabel(r.status))}</span>
          </button>
          ${mapBtn}
        </li>`;
      })
      .join('');

    return `
      <div class="lw-vinculos">
        <h3 class="lw-vinculos-title">Vínculos</h3>
        <p class="lw-hint lw-vinculos-hint">Patrocínio e espaço físico do mesmo participante ficam ligados aqui.</p>
        <ul class="lw-vinculos-list">${rows}</ul>
      </div>`;
  }

  function bindLeadVinculosHandlers(root) {
    root?.querySelectorAll('[data-lw-vinculo-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.lwVinculoId);
        if (id) void openLeadDetailModal(id);
      });
    });
    root?.querySelectorAll('[data-lw-espaco-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const espacoId = Number(btn.dataset.lwEspacoId);
        const numero = Number(btn.dataset.lwEspacoNumero) || null;
        const grupoSlug = btn.dataset.lwEspacoGrupo || '';
        if (onOpenEspaco) {
          void onOpenEspaco({ espacoId, numero, grupoSlug });
        } else if (onNavigate) {
          onNavigate('espacos');
        }
      });
    });
  }

  function renderLeadDealPanel(item) {
    if (!els.leadDealPanel || !item) return;
    cancelLeadFieldEdit();

    const p = getParticipanteById(item.participanteId);
    if (item.tipo === 'espaco' && item.espacoId) {
      void ensureTiposComercioDatalist();
    }
    const isArtistico = item.tipo === 'artistico';
    const isEspaco = item.tipo === 'espaco';
    const falta = Math.max(0, item.valorTotal - item.valorPago);
    const quitado = falta <= 0 && isVendaEtapaStatus(item.status);

    const fields = ['participante', 'contatoNome'];
    fields.push('instagram', 'whatsapp');
    if (hasParticipanteInstagram(p)) {
      fields.push('seguidores');
    }
    if (isEspaco && item.espacoId) {
      fields.push('tipoComercio');
    }
    if (!isEspaco) {
      fields.push('descricao');
    }
    fields.push('valorTotal');
    fields.push('obs');

    const staticRows = [];
    if (!isArtistico) {
      staticRows.push(`
        <div class="lw-info-row">
          <dt>Pago</dt>
          <dd class="lw-field-cell lw-field-cell--static"><span class="arr-valor-pago">${fmtMoney(item.valorPago)}</span></dd>
        </div>
        <div class="lw-info-row">
          <dt>Falta</dt>
          <dd class="lw-field-cell lw-field-cell--static"><span class="${quitado ? 'arr-valor-quitado' : 'arr-valor-falta'}">${quitado ? 'Quitado' : fmtMoney(falta)}</span></dd>
        </div>`);
    }
    if (isEspaco) {
      staticRows.push(`
        <div class="lw-info-row">
          <dt>Referência</dt>
          <dd class="lw-field-cell lw-field-cell--static"><span>${item.descricao ? escapeHtml(item.descricao) : '—'}</span></dd>
        </div>`);
    }

    const uniqueFields = [...new Set(fields)];
    const editableRows = uniqueFields.map((field) => renderLeadFieldRow(field, item, p));

    els.leadDealPanel.innerHTML = `
      <h2 class="lw-card-title">Dados do lead</h2>
      <p class="lw-hint lw-deal-hint">Clique em um valor para editar.</p>
      <dl class="lw-info-dl">
        ${editableRows.join('')}
        ${staticRows.join('')}
      </dl>
      ${renderLeadVinculosBlock(item)}
      ${renderSeguidoresHistoricoBlock(item)}
      <p class="lw-meta cell-muted">Cadastro: ${fmtDate(item.createdAt)} · Atualizado: ${fmtDate(item.updatedAt)}</p>
    `;

    els.leadDealPanel.querySelectorAll('[data-lw-field]').forEach((btn) => {
      btn.addEventListener('click', () => startLeadFieldEdit(btn.dataset.lwField, item));
    });
    bindLeadVinculosHandlers(els.leadDealPanel);

    bindLeadWhatsappChatAction(els.leadDealPanel);
    renderLeadOrigemFields(item);
  }

  function funnelStepsForLead() {
    return activeFunilEtapas().filter((e) => e.tipo !== 'perda');
  }

  function renderLeadFunilPanel(item) {
    if (!els.leadFunilSteps || !item) return;
    const steps = funnelStepsForLead();
    const escopoLabel = funilEscopoLabel(funilEscopoForItem(item));
    const titleEl = document.getElementById('lead-funil-title');
    if (titleEl) titleEl.textContent = `Etapa do funil — ${escopoLabel}`;
    if (!steps.length) {
      els.leadFunilSteps.innerHTML =
        '<p class="cell-empty lw-funil-empty">Configure etapas do funil na arrecadação.</p>';
      return;
    }

    const currentIndex = steps.findIndex((e) => e.status === item.status);
    const total = steps.length;

    els.leadFunilSteps.innerHTML = steps
      .map((etapa, index) => {
        const isActive = etapa.status === item.status;
        const isPast = currentIndex >= 0 && index < currentIndex;
        const width = 100 - index * (38 / Math.max(total - 1, 1));
        return `
        <button
          type="button"
          class="lw-funil-step ${isActive ? 'lw-funil-step--active' : ''} ${isPast ? 'lw-funil-step--past' : ''}"
          data-funil-status="${escapeHtml(etapa.status)}"
          style="--funil-width: ${width}%; --funil-color: ${escapeHtml(etapa.cor || '#5dcaa5')}"
          role="listitem"
          ${isActive ? 'aria-current="step"' : ''}
        >
          <span>${escapeHtml(etapa.titulo)}</span>
        </button>`;
      })
      .join('');

    els.leadFunilSteps.querySelectorAll('[data-funil-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.funilStatus;
        if (!status || status === item.status || leadFieldSaving) return;
        const etapa = etapaForStatus(status);
        if (etapa?.tipo === 'perda') {
          openPerdaLeadModal(item);
          return;
        }
        try {
          const { item: updated } = await updateArrecadacao(item.id, { status });
          if (updated) await refreshLeadDetailUi(updated);
          await loadArrecadacao();
          if (item.tipo === 'espaco' || item.tipo === 'patrocinio') {
            await onEspacosDataChanged?.();
          }
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function campanhaMatchesOrigem(campanha, origemId) {
    if (!origemId) return true;
    const ids = campanha.canalIds?.length
      ? campanha.canalIds
      : campanha.canalId
        ? [campanha.canalId]
        : [];
    return ids.includes(origemId);
  }

  function renderOrigemSelectOptions() {
    const { canais, campanhas, criativos } = marketingData;

    if (els.leadOrigemCanal) {
      const current = leadDetailItem?.marketingCanalId;
      els.leadOrigemCanal.innerHTML =
        '<option value="">Selecione</option>' +
        canais
          .filter((c) => c.ativo)
          .map(
            (c) =>
              `<option value="${c.id}"${c.id === current ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
    }

    const canalId = Number(els.leadOrigemCanal?.value) || leadDetailItem?.marketingCanalId || null;
    if (els.leadOrigemCampanha) {
      const current = leadDetailItem?.marketingCampanhaId;
      const list = campanhas.filter((c) => c.ativo && campanhaMatchesOrigem(c, canalId));
      els.leadOrigemCampanha.innerHTML =
        '<option value="">Selecione</option>' +
        list
          .map(
            (c) =>
              `<option value="${c.id}"${c.id === current ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
      if (current && !list.some((c) => c.id === current)) {
        els.leadOrigemCampanha.value = '';
      }
    }

    const campanhaId =
      Number(els.leadOrigemCampanha?.value) || leadDetailItem?.marketingCampanhaId || null;
    if (els.leadOrigemCriativo) {
      const current = leadDetailItem?.marketingCriativoId;
      const list = criativos.filter(
        (c) =>
          c.ativo &&
          (!campanhaId || c.campanhaId === campanhaId) &&
          (!canalId || (c.canalIds || []).includes(canalId)),
      );
      els.leadOrigemCriativo.innerHTML =
        '<option value="">Selecione</option>' +
        list
          .map(
            (c) =>
              `<option value="${c.id}"${c.id === current ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
      if (current && !list.some((c) => c.id === current)) {
        els.leadOrigemCriativo.value = '';
      }
    }
  }

  function renderLeadOrigemFields(item) {
    if (!els.leadOrigemCanal) return;
    renderOrigemSelectOptions();
    if (item?.marketingCanalId && els.leadOrigemCanal) {
      els.leadOrigemCanal.value = String(item.marketingCanalId);
    }
    if (item?.marketingCampanhaId && els.leadOrigemCampanha) {
      els.leadOrigemCampanha.value = String(item.marketingCampanhaId);
    }
    if (item?.marketingCriativoId && els.leadOrigemCriativo) {
      els.leadOrigemCriativo.value = String(item.marketingCriativoId);
    }
  }

  async function loadMarketingData() {
    try {
      marketingData = await fetchMarketing();
      marketingData.canais = marketingData.canais || [];
      marketingData.campanhas = marketingData.campanhas || [];
      marketingData.criativos = marketingData.criativos || [];
    } catch (_) {
      marketingData = { canais: [], campanhas: [], criativos: [] };
    }
  }

  async function saveLeadOrigem(patch) {
    if (!leadDetailId || leadOrigemSaving) return;
    leadOrigemSaving = true;
    try {
      const { item: updated } = await updateArrecadacao(leadDetailId, patch);
      const idx = items.findIndex((x) => x.id === leadDetailId);
      if (idx >= 0 && updated) items[idx] = { ...items[idx], ...updated };
      leadDetailItem = items.find((x) => x.id === leadDetailId) || updated;
      renderLeadOrigemFields(leadDetailItem);
    } catch (err) {
      alert(err.message);
      renderLeadOrigemFields(leadDetailItem);
    } finally {
      leadOrigemSaving = false;
    }
  }

  function buildLeadPayloadFromItem(item, patch = {}) {
    const p = getParticipanteById(item.participanteId);
    const payload = {
      participanteId: item.participanteId,
      participanteNome: item.participanteNome,
      status: item.status,
      valorTotal: item.valorTotal,
      obs: item.obs || '',
      descricao: item.descricao || '',
      ...patch,
    };

    if (patch.participanteInstagram !== undefined) {
      payload.participanteInstagram = patch.participanteInstagram;
    }
    if (patch.participanteWhatsapp !== undefined) {
      payload.participanteWhatsapp = patch.participanteWhatsapp;
    }
    if (patch.participanteSeguidores !== undefined) {
      payload.participanteSeguidores = patch.participanteSeguidores;
    }

    if (patch.participanteNome !== undefined) {
      const matched = matchParticipanteByNome(patch.participanteNome);
      payload.participanteId = matched?.id ?? null;
      payload.participanteNome = matched?.nome || patch.participanteNome;
    }

    if (item.tipo === 'artistico' && patch.descricao !== undefined) {
      payload.descricao = patch.descricao || 'Artístico';
    } else if (item.tipo === 'espaco') {
      payload.descricao = item.descricao;
    } else if (patch.descricao !== undefined) {
      payload.descricao = patch.descricao || 'Patrocínio';
    }

    return payload;
  }

  function isParticipanteProfilePatch(patch) {
    const keys = Object.keys(patch);
    return (
      keys.length > 0 &&
      keys.every((key) =>
        [
          'participanteNome',
          'participanteContatoNome',
          'participanteInstagram',
          'participanteWhatsapp',
          'participanteSeguidores',
        ].includes(key),
      )
    );
  }

  function buildParticipanteContactBody(participanteId, patch) {
    const p = getParticipanteById(participanteId);
    if (!p) {
      throw new Error('Participante não encontrado. Recarregue o lead e tente novamente.');
    }
    return {
      nome:
        patch.participanteNome !== undefined
          ? String(patch.participanteNome || '').trim()
          : p.nome,
      instagram:
        patch.participanteInstagram !== undefined ? patch.participanteInstagram : p.instagram || '',
      seguidores:
        patch.participanteSeguidores !== undefined ? patch.participanteSeguidores : p.seguidores,
      contatoTelefone:
        patch.participanteWhatsapp !== undefined
          ? patch.participanteWhatsapp
          : p.contatoTelefone || '',
      contatoNome:
        patch.participanteContatoNome !== undefined
          ? String(patch.participanteContatoNome || '').trim()
          : p.contatoNome || '',
    };
  }

  async function refreshParticipantesList() {
    const { participantes: updated } = await fetchParticipantes();
    participantes = updated || [];
    store?.setParticipantes(participantes);
    renderParticipantesDatalist();
  }

  async function refreshLeadDetailUi(item) {
    leadDetailItem = items.find((x) => x.id === item.id) || item;
    if (els.leadDetailTitle) {
      els.leadDetailTitle.textContent = leadDetailItem.participanteNome;
    }
    renderLeadAvatar(leadDetailItem);
    renderLeadBadges(leadDetailItem);
    renderLeadDealPanel(leadDetailItem);
    renderLeadFunilPanel(leadDetailItem);
    renderLeadOrigemFields(leadDetailItem);
    renderLeadDetailActions(leadDetailItem);
    renderLeadWhatsappAction(leadDetailItem);
  }

  async function persistLeadPatch(patch) {
    const item = leadDetailItem;
    if (!item || leadFieldSaving) return;

    leadFieldSaving = true;
    const row = els.leadDealPanel?.querySelector(`[data-lw-row="${leadFieldEditing}"]`);
    row?.classList.add('lw-info-row--saving');

    try {
      if (patch.espacoTipo !== undefined) {
        await updateArrecadacao(item.id, { espacoTipo: patch.espacoTipo });
        await loadArrecadacao();
        leadDetailItem = items.find((x) => x.id === item.id) || leadDetailItem;
        await refreshLeadDetailUi(leadDetailItem);
        if (leadDetailItem.tipo === 'espaco') await onEspacosDataChanged?.();
        return;
      }

      if (item.participanteId && isParticipanteProfilePatch(patch)) {
        const pBefore = getParticipanteById(item.participanteId);
        const prevSeguidores =
          patch.participanteSeguidores !== undefined ? (pBefore?.seguidores ?? null) : null;

        await updateParticipante(item.participanteId, {
          ...buildParticipanteContactBody(item.participanteId, patch),
          arrecadacaoId: item.id,
        });

        if (
          patch.participanteSeguidores !== undefined &&
          prevSeguidores !== patch.participanteSeguidores
        ) {
          const texto = buildSeguidoresInteracaoText(prevSeguidores, patch.participanteSeguidores);
          if (texto) {
            await createInteracao(item.id, { tipo: 'sistema', texto });
            await loadLeadDetailInteracoes(item.id);
          }
          if (item.participanteId) await loadSeguidoresHistorico(item.participanteId);
        }

        await refreshParticipantesList();
        await loadArrecadacao();
        leadDetailItem = items.find((x) => x.id === item.id) || leadDetailItem;
        await refreshLeadDetailUi(leadDetailItem);
        if (patch.participanteWhatsapp !== undefined) {
          renderLeadWhatsappAction(leadDetailItem);
        }
        if (leadDetailItem.tipo === 'espaco') await onEspacosDataChanged?.();
        return;
      }

      const payload = buildLeadPayloadFromItem(item, patch);
      if (!payload.participanteNome && !payload.participanteId) {
        alert('Informe o participante.');
        renderLeadDealPanel(leadDetailItem);
        return;
      }

      await updateArrecadacao(item.id, payload);
      await loadArrecadacao();
      leadDetailItem = items.find((x) => x.id === item.id) || leadDetailItem;
      await refreshLeadDetailUi(leadDetailItem);
      if (patch.participanteWhatsapp !== undefined) {
        renderLeadWhatsappAction(leadDetailItem);
      }
      if (leadDetailItem.tipo === 'espaco') await onEspacosDataChanged?.();
    } catch (err) {
      alert(err.message);
      renderLeadDealPanel(leadDetailItem);
    } finally {
      leadFieldSaving = false;
      cancelLeadFieldEdit();
    }
  }

  function startLeadFieldEdit(field, item) {
    if (leadFieldSaving || !leadFieldCanEdit(field, item)) return;
    cancelLeadFieldEdit();
    leadFieldEditing = field;

    const row = els.leadDealPanel?.querySelector(`[data-lw-row="${field}"]`);
    const cell = row?.querySelector('.lw-field-cell');
    if (!cell) return;

    const p = getParticipanteById(item.participanteId);
    row.classList.add('lw-info-row--editing');
    cell.innerHTML = '';

    let input;
    if (field === 'status') {
      input = document.createElement('select');
      input.className = 'lw-field-editor';
      renderStatusSelectOptions(item.status, input);
    } else if (field === 'obs') {
      input = document.createElement('textarea');
      input.className = 'lw-field-editor lw-field-editor--area';
      input.rows = 3;
      input.value = item.obs || '';
    } else if (field === 'valorTotal') {
      input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.className = 'lw-field-editor';
      input.value = formatValorInput(item.valorTotal ?? 0);
      input.addEventListener('input', (e) => maskValorInput(e.target));
    } else if (field === 'participante') {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'lw-field-editor';
      input.setAttribute('list', 'arrecadacao-participantes-list');
      input.value = item.participanteNome || '';
    } else if (field === 'contatoNome') {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'lw-field-editor';
      input.placeholder = 'Ex.: Maria (responsável pelo WhatsApp)';
      input.value = p?.contatoNome || '';
    } else if (field === 'whatsapp') {
      input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'tel';
      input.className = 'lw-field-editor';
      input.value = p?.contatoTelefone ? formatPhoneDisplay(p.contatoTelefone) : '';
      input.addEventListener('input', (e) => maskPhoneInput(e.target));
    } else if (field === 'seguidores') {
      input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.className = 'lw-field-editor';
      input.placeholder = 'Ex.: 12500';
      input.value = p?.seguidores != null ? String(p.seguidores) : '';
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });
    } else if (field === 'tipoComercio') {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'lw-field-editor';
      input.setAttribute('list', 'tipos-comercio');
      input.placeholder = 'Ex.: Alimentação';
      input.value = item.espacoTipo || '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'lw-field-editor';
      if (field === 'descricao') {
        input.placeholder = item.tipo === 'artistico' ? 'Ex.: Banda XYZ' : 'Ex.: Patrocínio master';
        input.value = item.descricao || '';
      } else if (field === 'instagram') {
        input.placeholder = '@usuario';
        input.value = p?.instagram || '';
      }
    }

    input.dataset.lwField = field;
    cell.appendChild(input);
    input.focus();
    if (input.select && field !== 'obs') input.select();

    let finished = false;

    const buildPatch = () => {
      const patch = {};
      if (field === 'participante') {
        patch.participanteNome = input.value.trim();
      } else if (field === 'contatoNome') {
        patch.participanteContatoNome = input.value.trim();
      } else if (field === 'instagram') {
        patch.participanteInstagram = input.value.trim();
      } else if (field === 'whatsapp') {
        patch.participanteWhatsapp = input.value.replace(/\D/g, '');
      } else if (field === 'seguidores') {
        const raw = input.value.trim();
        patch.participanteSeguidores = raw ? Number(raw) : null;
      } else if (field === 'tipoComercio') {
        patch.espacoTipo = input.value.trim();
      } else if (field === 'status') {
        patch.status = input.value;
      } else if (field === 'descricao') {
        patch.descricao = input.value.trim();
      } else if (field === 'valorTotal') {
        patch.valorTotal = parseValor(input.value) ?? 0;
      } else if (field === 'obs') {
        patch.obs = input.value.trim();
      }
      return patch;
    };

    const saveEdit = async (patch) => {
      if (finished || leadFieldSaving) return;
      leadFieldEditing = field;
      try {
        await persistLeadPatch(patch);
        finished = true;
      } catch (_) {
        renderLeadDealPanel(leadDetailItem);
      }
    };

    const cancel = () => {
      if (finished || leadFieldSaving) return;
      if (leadFieldEditing !== field) return;
      cancelLeadFieldEdit();
      renderLeadDealPanel(leadDetailItem);
    };

    if (field === 'status') {
      input.addEventListener('change', () => saveEdit(buildPatch()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancel();
      });
    } else {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && field !== 'obs') {
          e.preventDefault();
          e.stopPropagation();
          saveEdit(buildPatch());
        }
        if (e.key === 'Escape') cancel();
      });
      input.addEventListener('blur', () => {
        const patchOnBlur = buildPatch();
        window.setTimeout(() => {
          if (finished || leadFieldSaving) return;
          saveEdit(patchOnBlur);
        }, 150);
      });
    }
  }

  function renderLeadAvatar(item) {
    if (!els.leadAvatar) return;
    const p = getParticipanteById(item?.participanteId);
    mountContactAvatar(
      els.leadAvatar,
      {
        participanteId: item?.participanteId,
        participanteNome: item?.participanteNome,
        avatarUrl: p?.avatarUrl,
      },
      'lw-avatar',
    );
  }

  function renderLeadBadges(item) {
    if (!els.leadDetailBadges) return;
    const tipoBadge = canMigrateBadge(item)
      ? `<button type="button" class="badge ${tipoBadgeClass(item.tipo)} badge-migrate-artistico" data-action="migrar-artistico-badge" title="Clique para mover para Artístico">${TIPO_LABELS[item.tipo]}</button>`
      : `<span class="badge ${tipoBadgeClass(item.tipo)}">${TIPO_LABELS[item.tipo]}</span>`;
    els.leadDetailBadges.innerHTML = `
      ${tipoBadge}
      <span class="badge ${item.status}">${escapeHtml(etapaLabel(item.status))}</span>
    `;
    els.leadDetailBadges
      .querySelector('[data-action="migrar-artistico-badge"]')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        migrateToArtistico(item.id);
      });
  }

  function renderLeadDetailActions(item) {
    if (!els.leadDetailActions) return;

    const artistico = item.tipo === 'artistico';
    els.leadDetailActions.innerHTML = `
      ${artistico ? '' : leadActionIconBtn({ action: 'pagamento', title: 'Registrar pagamento', icon: ICON_PAYMENT })}
      ${
        canMigrateToArtistico(item)
          ? leadActionIconBtn({ action: 'migrar-artistico', title: 'Mover para Artístico', icon: ICON_ARTISTIC })
          : ''
      }
      ${canRegisterPerdaLead(item) ? leadActionIconBtn({ action: 'perda', title: 'Perda do lead', icon: ICON_PERDA, danger: true }) : ''}
      ${artistico ? leadActionIconBtn({ action: 'excluir', title: 'Excluir lead', icon: ICON_DELETE, danger: true }) : ''}
    `;
    els.leadDetailActions.querySelectorAll('[data-lead-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.leadAction;
        if (action === 'migrar-artistico') {
          migrateToArtistico(item.id);
          return;
        }
        if (action === 'excluir') {
          deleteArtisticoLead(item);
          return;
        }
        if (action === 'pagamento') openPagamentoModal(item);
        else if (action === 'perda') openPerdaLeadModal(item);
      });
    });
  }

  function renderLeadWhatsappTimelineLink(item = leadDetailItem) {
    const p = getParticipanteById(item?.participanteId);
    const phone = String(p?.contatoTelefone || '').trim();
    if (!phone) return '';

    const display = formatPhoneDisplay(phone);
    return `
      <article class="lead-interacao-item lead-interacao-item--whatsapp-chat" data-tipo="whatsapp-chat">
        <button type="button" class="lead-interacao-whatsapp-chat" data-action="open-whatsapp-chat" data-participante-id="${item?.participanteId || ''}">
          <span class="lead-interacao-whatsapp-chat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </span>
          <span class="lead-interacao-whatsapp-chat-body">
            <strong>Conversa no WhatsApp</strong>
            <span class="lead-interacao-whatsapp-chat-phone">${escapeHtml(display)}</span>
          </span>
          <span class="lead-interacao-whatsapp-chat-action" aria-hidden="true">Abrir</span>
        </button>
      </article>`;
  }

  function bindLeadWhatsappChatAction(root = document) {
    bindWhatsappChatButtons(root, (participanteId) =>
      handleOpenWhatsappChat(participanteId, { closeLead: true }),
    );
  }

  function renderLeadWhatsappInteraction(item = leadDetailItem) {
    if (!els.leadWhatsappInteraction) return;
    const html = renderLeadWhatsappTimelineLink(item);
    if (!html) {
      els.leadWhatsappInteraction.hidden = true;
      els.leadWhatsappInteraction.innerHTML = '';
      return;
    }
    els.leadWhatsappInteraction.hidden = false;
    els.leadWhatsappInteraction.innerHTML = html;
    bindLeadWhatsappChatAction(els.leadWhatsappInteraction);
  }

  function renderInteracoesLoading(message = 'Carregando histórico…') {
    if (!els.leadInteracoesList) return;
    els.leadInteracoesList.innerHTML = `<p class="cell-muted lead-interacoes-loading">${escapeHtml(message)}</p>`;
  }

  function renderInteracoesList() {
    if (!els.leadInteracoesList) return;

    const interacoesHtml = leadDetailInteracoes
      .map((i) => {
        if (i.tipo === 'sistema') {
          return `
        <article class="lead-interacao-item lead-interacao-item--auto" data-tipo="sistema">
          <p class="lead-interacao-texto-auto">
            <time datetime="${escapeHtml(i.criadoEm || '')}">${fmtDate(i.criadoEm)}</time>
            <span>${escapeHtml(i.texto)}</span>
          </p>
        </article>`;
        }
        return `
        <article class="lead-interacao-item" data-tipo="${escapeHtml(i.tipo)}">
          <header class="lead-interacao-item-head">
            <span class="lead-interacao-tipo">${escapeHtml(i.tipoLabel || INTERACAO_TIPO_LABELS[i.tipo] || i.tipo)}</span>
            <time class="cell-muted">${fmtDate(i.criadoEm)}</time>
          </header>
          <p class="lead-interacao-texto">${escapeHtml(i.texto)}</p>
        </article>`;
      })
      .join('');

    if (!interacoesHtml) {
      els.leadInteracoesList.innerHTML =
        '<p class="cell-empty lead-interacoes-empty">Nenhuma interação registrada.</p>';
      return;
    }

    els.leadInteracoesList.innerHTML = interacoesHtml;
  }

  async function loadLeadDetailInteracoes(id) {
    const data = await fetchInteracoes(id);
    leadDetailInteracoes = data.interacoes || [];
    renderInteracoesList();
  }

  function renderLeadWhatsappAction(item) {
    renderLeadWhatsappInteraction(item);
    renderInteracoesList();
  }

  function renderResponsavelOptions(selectEl, selectedId = null) {
    if (!selectEl) return;
    const current = selectedId != null ? String(selectedId) : '';
    selectEl.innerHTML =
      '<option value="">Selecione</option>' +
      usuarios
        .map(
          (u) =>
            `<option value="${u.id}"${String(u.id) === current ? ' selected' : ''}>${escapeHtml(u.name)}</option>`,
        )
        .join('');
  }

  async function ensureUsuariosLoaded() {
    if (usuarios.length) return;
    try {
      const data = await fetchUsers();
      usuarios = data.users || [];
    } catch (_) {
      usuarios = loggedUser ? [loggedUser] : [];
    }
    renderResponsavelOptions(els.leadTarefaResponsavel, loggedUser?.id);
  }

  function resetLeadTarefaForm() {
    if (els.leadTarefaNome) els.leadTarefaNome.value = '';
    if (els.leadTarefaData) els.leadTarefaData.value = '';
    if (els.leadTarefaHora) els.leadTarefaHora.value = '';
    if (els.leadTarefaTipo) els.leadTarefaTipo.value = '';
    renderResponsavelOptions(els.leadTarefaResponsavel, loggedUser?.id);
  }

  function renderLeadTarefasTable() {
    if (!els.leadTarefasTable) return;
    if (!leadDetailTarefas.length) {
      els.leadTarefasTable.innerHTML = `
        <tr class="lead-tarefas-empty-row">
          <td colspan="5">Nenhuma tarefa agendada.</td>
        </tr>`;
      return;
    }
    els.leadTarefasTable.innerHTML = leadDetailTarefas
      .map((t) => {
        const atrasada = isTarefaAtrasada(t.agendadoPara, t.concluida);
        const tipoLabel = TAREFA_TIPO_LABELS[t.tipoTarefa] || t.tipoTarefa || '—';
        return `
        <tr class="lead-tarefa-row ${atrasada ? 'lead-tarefa-row-atrasada' : ''}">
          <td>${escapeHtml(t.observacao || '—')}</td>
          <td class="${atrasada ? 'tarefa-data-atrasada' : ''}">${escapeHtml(fmtAgendadoComAs(t.agendadoPara))}${atrasada ? ' · Atrasada' : ''}</td>
          <td>${escapeHtml(tipoLabel)}</td>
          <td>${escapeHtml(t.responsavelNome || '—')}</td>
          <td>
            <span class="lead-tarefa-actions">
              <button class="icon-btn" type="button" data-action="editar-lead-tarefa" data-id="${t.id}" title="Editar" aria-label="Editar tarefa">✎</button>
              <button class="tbtn" type="button" data-action="concluir-lead-tarefa" data-id="${t.id}">Concluir</button>
            </span>
          </td>
        </tr>`;
      })
      .join('');

    els.leadTarefasTable.querySelectorAll('[data-action="editar-lead-tarefa"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tarefa = leadDetailTarefas.find((t) => t.id === Number(btn.dataset.id));
        if (tarefa && openTarefaEditor) openTarefaEditor(tarefa, { usuarios });
      });
    });

    els.leadTarefasTable.querySelectorAll('[data-action="concluir-lead-tarefa"]').forEach((btn) => {
      btn.addEventListener('click', () => concluirLeadTarefa(Number(btn.dataset.id)));
    });
  }

  async function loadLeadDetailTarefas(id) {
    const data = await fetchTarefasLead(id);
    leadDetailTarefas = data.tarefas || [];
    renderLeadTarefasTable();
  }

  async function concluirLeadTarefa(id) {
    if (!id) return;
    try {
      await concluirTarefaContato(id);
      if (leadDetailId) await loadLeadDetailTarefas(leadDetailId);
      onTarefaChanged?.();
    } catch (err) {
      alert(err.message);
    }
  }

  async function submitLeadTarefa(e) {
    e.preventDefault();
    if (!leadDetailId) return;

    const item = items.find((x) => x.id === leadDetailId);
    if (!item) return;

    const observacao = els.leadTarefaNome?.value.trim() || '';
    const agendadoPara = combineDateAndTime(els.leadTarefaData?.value, els.leadTarefaHora?.value);
    const tipoTarefa = els.leadTarefaTipo?.value || '';
    const responsavelId = Number(els.leadTarefaResponsavel?.value) || null;

    if (!observacao) {
      alert('Informe o nome da tarefa.');
      return;
    }
    if (!agendadoPara) {
      alert('Informe data e hora do agendamento.');
      return;
    }
    if (!tipoTarefa) {
      alert('Selecione o tipo de tarefa.');
      return;
    }
    if (!responsavelId) {
      alert('Selecione o responsável pela tarefa.');
      return;
    }

    const btn = els.leadTarefaForm?.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Salvando…';
    }

    try {
      await createTarefaContato({
        participanteId: item.participanteId,
        arrecadacaoId: leadDetailId,
        agendadoPara,
        observacao,
        tipoTarefa,
        responsavelId,
      });
      resetLeadTarefaForm();
      await loadLeadDetailTarefas(leadDetailId);
      onTarefaChanged?.();
    } catch (err) {
      alert(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Salvar';
      }
    }
  }

  function openLeadWorkspaceUi() {
    els.leadWorkspace?.classList.remove('hidden');
    document.body.classList.add('lead-workspace-open');
  }

  function closeLeadWorkspace() {
    els.leadWorkspace?.classList.add('hidden');
    document.body.classList.remove('lead-workspace-open');
    leadDetailId = null;
    leadDetailItem = null;
    leadDetailInteracoes = [];
    leadSeguidoresHistorico = { historico: [], resumo: {} };
    leadDetailTarefas = [];
    cancelLeadFieldEdit();
  }

  async function openLeadDetailModal(id) {
    const item = await ensureLeadItem(id);
    if (!item) {
      alert('Lead não encontrado.');
      return false;
    }

    leadDetailId = id;
    leadDetailItem = item;
    leadDetailInteracoes = [];
    leadDetailTarefas = [];

    if (els.leadDetailTitle) els.leadDetailTitle.textContent = item.participanteNome;

    renderLeadAvatar(item);
    renderLeadBadges(item);
    renderLeadDealPanel(item);
    renderLeadDetailActions(item);
    renderLeadWhatsappAction(item);

    if (els.leadInteracaoTipo) els.leadInteracaoTipo.value = 'nota';
    if (els.leadInteracaoTexto) els.leadInteracaoTexto.value = '';
    resetLeadTarefaForm();
    renderInteracoesLoading();
    if (els.leadTarefasTable) {
      els.leadTarefasTable.innerHTML =
        '<tr class="lead-tarefas-empty-row"><td colspan="5">Carregando…</td></tr>';
    }
    if (els.leadAnotacoesDetails) els.leadAnotacoesDetails.open = false;
    if (els.leadTarefasDetails) els.leadTarefasDetails.open = false;

    openLeadWorkspaceUi();

    try {
      await ensureUsuariosLoaded();
      await loadMarketingData();
      await ensureFunilForItem(item);
      const loads = [loadLeadDetailInteracoes(id), loadLeadDetailTarefas(id)];
      const pOpen = getParticipanteById(item.participanteId);
      if (item.participanteId && hasParticipanteInstagram(pOpen)) {
        loads.push(loadSeguidoresHistorico(item.participanteId));
      }
      await Promise.all(loads);
      renderLeadDealPanel(leadDetailItem || item);
      renderLeadFunilPanel(leadDetailItem || item);
      renderLeadOrigemFields(leadDetailItem || item);
    } catch (err) {
      renderLeadWhatsappInteraction(item);
      els.leadInteracoesList.innerHTML = `<p class="cell-empty">${escapeHtml(err.message)}</p>`;
      if (els.leadTarefasTable) {
        els.leadTarefasTable.innerHTML = `<tr class="lead-tarefas-empty-row"><td colspan="5">${escapeHtml(err.message)}</td></tr>`;
      }
    }

    els.leadInteracaoTexto?.focus();
    return true;
  }

  async function openLeadDetail(id, { tipo, navigate = false } = {}) {
    const numId = Number(id);
    let item = resolveLeadItem(numId);
    if (!item) {
      item = await ensureLeadItem(numId);
    }
    const resolvedTipo = tipo || item?.tipo;

    if (resolvedTipo === 'artistico') {
      await switchLeadScope('artistico', { navigate });
    } else if (
      resolvedTipo === 'patrocinio' ||
      resolvedTipo === 'espaco' ||
      resolvedTipo === 'contato'
    ) {
      await switchLeadScope('comercial', { navigate });
    } else if (!items.find((x) => x.id === numId)) {
      for (const scope of ['comercial', 'artistico']) {
        const data = await fetchArrecadacao({ scope });
        const found = itemsForScope(data.items || [], scope).find((x) => x.id === numId);
        if (found) {
          await switchLeadScope(scope, { navigate });
          break;
        }
      }
    }
    if (!resolveLeadItem(numId)) {
      await loadArrecadacao();
    }
    return openLeadDetailModal(numId);
  }

  async function switchLeadScope(scope, { navigate = false } = {}) {
    applyLeadScope(scope);
    if (navigate) onNavigate?.(PAGE_CONFIG[leadScope].navView);
    return loadArrecadacao();
  }

  async function refreshLeadWorkspace() {
    if (!leadDetailId) return;
    const item = resolveLeadItem(leadDetailId);
    if (!item) return;
    leadDetailItem = item;
    if (els.leadDetailTitle) els.leadDetailTitle.textContent = item.participanteNome;
    renderLeadAvatar(item);
    renderLeadBadges(item);
    renderLeadDealPanel(item);
    renderLeadDetailActions(item);
  }

  async function submitLeadInteracao(e) {
    e.preventDefault();
    if (!leadDetailId) return;

    const tipo = els.leadInteracaoTipo?.value || 'nota';
    const texto = els.leadInteracaoTexto?.value.trim();
    if (!texto) {
      alert('Informe o registro da interação.');
      return;
    }

    const btn = els.leadInteracaoForm?.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Salvando…';
    }

    try {
      await createInteracao(leadDetailId, { tipo, texto });
      if (els.leadInteracaoTexto) els.leadInteracaoTexto.value = '';
      if (els.leadAnotacoesDetails) els.leadAnotacoesDetails.open = false;
      await loadLeadDetailInteracoes(leadDetailId);
    } catch (err) {
      alert(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Salvar';
      }
    }
  }

  function bindKanbanInteractions(root) {
    root.querySelectorAll('.arr-kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        kanbanCardWasDragged = false;
        const groupIds = card.dataset.groupIds || card.dataset.id;
        draggingItemId = Number(card.dataset.id);
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', groupIds);
      });
      card.addEventListener('drag', () => {
        kanbanCardWasDragged = true;
      });
      card.addEventListener('dragend', () => {
        draggingItemId = null;
        card.classList.remove('dragging');
        root.querySelectorAll('.arr-kanban-col-body').forEach((col) => {
          col.classList.remove('drag-over');
        });
        setTimeout(() => {
          kanbanCardWasDragged = false;
        }, 0);
      });
      card.addEventListener('click', (e) => {
        if (kanbanCardWasDragged) return;
        if (e.target.closest('[data-action]')) return;
        const id = Number(card.dataset.id);
        if (id) openLeadDetailModal(id);
      });
      card.style.cursor = 'pointer';
    });

    root.querySelectorAll('.arr-kanban-col-body').forEach((body) => {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('drag-over');
      });
      body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const raw = e.dataTransfer.getData('text/plain') || String(draggingItemId || '');
        const ids = raw
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((id) => Number.isInteger(id) && id > 0);
        const status = body.closest('.arr-kanban-col')?.dataset.status;
        if (ids.length && status) await moveItemsToStatus(ids, status);
      });
    });

    root.querySelectorAll('.arr-kanban-card .arr-ref-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLeadDetailModal(Number(btn.dataset.id));
      });
    });

    root.querySelectorAll('[data-action="edit"], [data-action="abrir-lead"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) openLeadDetailModal(item.id);
      });
    });
    root.querySelectorAll('[data-action="pagamento"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) openPagamentoModal(item);
      });
    });
    root.querySelectorAll('[data-action="perda-lead"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) openPerdaLeadModal(item);
      });
    });
  }

  async function moveItemsToStatus(ids, status) {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return;

    const firstItem = items.find((x) => x.id === uniqueIds[0]);
    const etapa = etapaForStatus(status);
    if (etapa?.tipo === 'perda') {
      if (firstItem) openPerdaLeadModal(firstItem);
      return;
    }

    const toMove = uniqueIds.filter((id) => {
      const item = items.find((x) => x.id === id);
      return item && item.status !== status;
    });
    if (!toMove.length) return;

    try {
      for (const id of toMove) {
        await updateArrecadacao(id, { status });
      }
      await loadArrecadacao();
      const needsEspacosRefresh = toMove.some((id) => {
        const item = items.find((x) => x.id === id);
        return item?.tipo === 'espaco' || item?.tipo === 'patrocinio';
      });
      if (needsEspacosRefresh) await onEspacosDataChanged?.();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderKanban() {
    if (!els.kanbanView) return;

    const etapas = activeFunilEtapas();
    const activeStatuses = new Set(etapas.map((e) => e.status));
    const outros = items.filter((item) => !activeStatuses.has(item.status));

    const columns = [
      ...etapas.map((etapa) => {
        const colItems = items.filter((item) => item.status === etapa.status);
        const colGroups = groupItemsForTable(colItems);
        const total = colItems.reduce((s, i) => s + Number(i.valorTotal || 0), 0);
        return `
          <div class="arr-kanban-col" data-status="${escapeHtml(etapa.status)}">
            <header class="arr-kanban-col-head" style="--col-color:${escapeHtml(etapa.cor)}">
              <span class="arr-kanban-col-title">${escapeHtml(etapa.titulo)}</span>
              <span class="arr-kanban-col-meta">${colGroups.length} · ${fmtMoney(total)}</span>
            </header>
            <div class="arr-kanban-col-body">
              ${colGroups.length ? colGroups.map(renderKanbanGroupCard).join('') : '<p class="arr-kanban-empty">Nenhum registro</p>'}
            </div>
          </div>`;
      }),
      outros.length
        ? `
        <div class="arr-kanban-col arr-kanban-col-outros" data-status="">
          <header class="arr-kanban-col-head" style="--col-color:#666">
            <span class="arr-kanban-col-title">Outros status</span>
            <span class="arr-kanban-col-meta">${groupItemsForTable(outros).length}</span>
          </header>
          <div class="arr-kanban-col-body arr-kanban-col-body-readonly">
            ${groupItemsForTable(outros).map(renderKanbanGroupCard).join('')}
          </div>
        </div>`
        : '',
    ].join('');

    els.kanbanView.innerHTML = columns || '<p class="cell-empty">Configure ao menos uma etapa ativa no funil.</p>';
    bindKanbanInteractions(els.kanbanView);

    const total = items.length;
    els.summary.textContent =
      total > 0
        ? `${total} registro(s) no kanban · ${etapas.length} etapa(s) ativa(s)`
        : 'Nenhum registro de arrecadação no kanban.';
  }

  function syncDraftFunilFromDom() {
    if (!els.funilEtapasList) return;
    els.funilEtapasList.querySelectorAll('.funil-etapa-row').forEach((row, index) => {
      const etapa = draftFunilEtapas[index];
      if (!etapa) return;
      const titulo = row.querySelector('.funil-etapa-titulo')?.value;
      const cor = row.querySelector('.funil-etapa-cor')?.value;
      const tipo = row.querySelector('.funil-etapa-tipo')?.value;
      const ativo = row.querySelector('[data-field="ativo"]')?.checked;
      if (titulo != null) etapa.titulo = titulo;
      if (cor) etapa.cor = cor;
      if (tipo) etapa.tipo = tipo;
      if (ativo != null) etapa.ativo = ativo;
    });
  }

  function validateEtapaTipos(etapas) {
    const perdas = etapas.filter((e) => e.tipo === 'perda').length;
    const vendas = etapas.filter((e) => e.tipo === 'venda').length;
    if (perdas > 1) return 'Defina apenas uma etapa do tipo Perda.';
    if (vendas > 1) return 'Defina apenas uma etapa do tipo Venda.';
    if (!etapas.some((e) => e.ativo && (e.tipo || 'normal') === 'normal')) {
      return 'Mantenha ao menos uma etapa normal ativa para novos leads.';
    }
    return null;
  }

  function renderEtapaTipoOptions(etapa, index) {
    const usedPerda = draftFunilEtapas.some((e, i) => i !== index && e.tipo === 'perda');
    const usedVenda = draftFunilEtapas.some((e, i) => i !== index && e.tipo === 'venda');
    const tipo = etapa.tipo || 'normal';
    return `
      <option value="normal" ${tipo === 'normal' ? 'selected' : ''}>Etapa</option>
      <option value="perda" ${tipo === 'perda' ? 'selected' : ''} ${usedPerda && tipo !== 'perda' ? 'disabled' : ''}>Perda</option>
      <option value="venda" ${tipo === 'venda' ? 'selected' : ''} ${usedVenda && tipo !== 'venda' ? 'disabled' : ''}>Venda</option>
    `;
  }

  function reorderFunilEtapa(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= draftFunilEtapas.length || toIndex >= draftFunilEtapas.length) return;
    syncDraftFunilFromDom();
    const [item] = draftFunilEtapas.splice(fromIndex, 1);
    draftFunilEtapas.splice(toIndex, 0, item);
    draftFunilEtapas.forEach((e, i) => {
      e.ordem = i;
    });
    renderFunilConfigList();
  }

  function bindFunilDragDrop() {
    if (!els.funilEtapasList) return;

    els.funilEtapasList.querySelectorAll('.funil-drag-handle').forEach((handle) => {
      handle.addEventListener('dragstart', (e) => {
        syncDraftFunilFromDom();
        const index = Number(handle.dataset.index);
        handle.closest('.funil-etapa-row')?.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      });
      handle.addEventListener('dragend', () => {
        els.funilEtapasList.querySelectorAll('.funil-etapa-row').forEach((row) => {
          row.classList.remove('dragging', 'drag-over');
        });
      });
    });

    els.funilEtapasList.querySelectorAll('.funil-etapa-row').forEach((row) => {
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(row.dataset.index);
        if (!Number.isInteger(from) || !Number.isInteger(to)) return;
        reorderFunilEtapa(from, to);
      });
    });
  }

  function renderFunilConfigList() {
    if (!els.funilEtapasList) return;

    els.funilEtapasList.innerHTML = draftFunilEtapas
      .map((etapa, index) => {
        const tipo = etapa.tipo || 'normal';
        return `
        <div class="funil-etapa-row" data-index="${index}">
          <button class="funil-drag-handle" type="button" draggable="true" data-index="${index}" title="Arrastar para reordenar" aria-label="Reordenar etapa">⠿</button>
          <input class="funil-etapa-titulo" type="text" value="${escapeHtml(etapa.titulo)}" data-field="titulo" data-index="${index}" placeholder="Nome da etapa" aria-label="Nome da etapa" />
          <select class="funil-etapa-tipo" data-index="${index}" aria-label="Tipo da etapa">${renderEtapaTipoOptions(etapa, index)}</select>
          <input class="funil-etapa-cor" type="color" value="${escapeHtml(etapa.cor)}" data-field="cor" data-index="${index}" title="Cor da coluna" />
          <label class="funil-etapa-ativo">
            <input type="checkbox" data-field="ativo" data-index="${index}" ${etapa.ativo ? 'checked' : ''} />
            <span class="funil-etapa-ativo-label">Ativa</span>
          </label>
          <button class="icon-btn danger" type="button" data-action="funil-remove" data-index="${index}" title="Remover etapa">×</button>
        </div>`;
      })
      .join('');

    els.funilEtapasList.querySelectorAll('[data-field]').forEach((el) => {
      const handler = () => {
        const index = Number(el.dataset.index);
        const field = el.dataset.field;
        if (!draftFunilEtapas[index]) return;
        if (field === 'ativo') draftFunilEtapas[index].ativo = el.checked;
        else draftFunilEtapas[index][field] = el.value;
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    els.funilEtapasList.querySelectorAll('.funil-etapa-tipo').forEach((el) => {
      el.addEventListener('change', () => {
        const index = Number(el.dataset.index);
        if (!draftFunilEtapas[index]) return;
        draftFunilEtapas[index].tipo = el.value;
        const err = validateEtapaTipos(draftFunilEtapas);
        if (err) {
          alert(err);
          draftFunilEtapas[index].tipo = 'normal';
        }
        renderFunilConfigList();
      });
    });

    els.funilEtapasList.querySelectorAll('[data-action="funil-remove"]').forEach((btn) => {
      btn.addEventListener('click', () => removeFunilEtapa(Number(btn.dataset.index)));
    });

    bindFunilDragDrop();
  }

  function removeFunilEtapa(index) {
    if (draftFunilEtapas.length <= 1) {
      alert('Mantenha ao menos uma etapa no funil.');
      return;
    }
    syncDraftFunilFromDom();
    draftFunilEtapas.splice(index, 1);
    draftFunilEtapas.forEach((e, i) => {
      e.ordem = i;
    });
    renderFunilConfigList();
  }

  function openFunilModal() {
    const escopo = funilEscopoForLeadScope(leadScope);
    if (els.funilModalTitle) {
      els.funilModalTitle.textContent = `Configurar funil — ${funilEscopoLabel(escopo)}`;
    }
    if (els.funilModalSub) {
      els.funilModalSub.textContent =
        escopo === 'artistico'
          ? 'Etapas do funil para leads artísticos. Defina uma coluna de Perda e uma de Venda.'
          : 'Etapas do funil de arrecadação (patrocínios e negociações). Defina uma coluna de Perda e uma de Venda.';
    }
    draftFunilEtapas = funilEtapas.map((e) => ({
      ...e,
      tipo: e.tipo || 'normal',
    }));
    if (els.funilNewTitulo) els.funilNewTitulo.value = '';
    renderFunilConfigList();
    els.funilModalBg?.classList.add('open');
    els.funilNewTitulo?.focus();
  }

  function closeFunilModal() {
    els.funilModalBg?.classList.remove('open');
    draftFunilEtapas = [];
  }

  async function saveFunilConfig() {
    syncDraftFunilFromDom();
    const tiposErr = validateEtapaTipos(draftFunilEtapas);
    if (tiposErr) {
      alert(tiposErr);
      return;
    }
    for (const etapa of draftFunilEtapas) {
      if (!String(etapa.titulo || '').trim()) {
        alert('Todas as etapas precisam de um nome.');
        return;
      }
    }
    els.funilBtnSave.disabled = true;
    els.funilBtnSave.textContent = 'Salvando…';
    try {
      const payload = draftFunilEtapas.map((e, ordem) => ({
        status: e.status,
        titulo: e.titulo.trim(),
        tipo: e.tipo || 'normal',
        cor: e.cor,
        ordem,
        ativo: e.ativo,
      }));
      const data = await saveFunilEtapas(payload, { escopo: funilEscopoForLeadScope(leadScope) });
      funilEtapas = data.etapas || payload;
      funilEscopoAtual = data.escopo || funilEscopoForLeadScope(leadScope);
      closeFunilModal();
      await loadArrecadacao();
    } catch (err) {
      alert(err.message);
    } finally {
      els.funilBtnSave.disabled = false;
      els.funilBtnSave.textContent = 'Salvar funil';
    }
  }

  function addFunilEtapa() {
    const titulo = els.funilNewTitulo?.value.trim();
    if (!titulo) {
      alert('Informe o nome da nova etapa.');
      els.funilNewTitulo?.focus();
      return;
    }
    draftFunilEtapas.push({
      status: uniqueEtapaStatus(titulo, draftFunilEtapas),
      titulo,
      tipo: 'normal',
      cor: '#85B7EB',
      ordem: draftFunilEtapas.length,
      ativo: true,
    });
    if (els.funilNewTitulo) els.funilNewTitulo.value = '';
    renderFunilConfigList();
    els.funilNewTitulo?.focus();
  }

  async function loadArrecadacao() {
    const scope = leadScope;
    const seq = ++loadSeq;
    const data = await fetchArrecadacao({ scope });
    if (seq !== loadSeq || scope !== leadScope) return items;

    items = itemsForScope(data.items || [], scope);
    espacosDisponiveis = scope === 'comercial' ? data.espacosDisponiveis || [] : [];
    participantes = data.participantes || [];
    funilEtapas = data.funilEtapas || [];
    funilEscopoAtual = data.funilEscopo || funilEscopoForLeadScope(scope);
    store?.setParticipantes(participantes);
    renderParticipantesDatalist();
    renderStats(summarizeItems(items));
    setViewMode(viewMode);
    renderDisponiveisTable();
    await refreshLeadWorkspace();
    return items;
  }

  function bindTableAction(action, handler) {
    els.table.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) handler(item);
      });
    });
  }

  function renderArtisticoContatoCell(item) {
    const p = getParticipanteById(item.participanteId);
    const ig = p?.instagram ? formatInstagram(p.instagram) : '';
    const wa = p?.contatoTelefone ? formatPhoneDisplay(p.contatoTelefone) : '';
    const lines = [
      `<button type="button" class="arr-ref-chip arr-ref-chip--nome" data-action="abrir-lead" data-id="${item.id}" title="Abrir lead">${escapeHtml(item.participanteNome)}</button>`,
    ];
    if (ig && ig !== '—') {
      lines.push(`<div class="arr-artistico-contato-line">${escapeHtml(ig)}</div>`);
    }
    if (wa) {
      lines.push(
        `<div class="arr-artistico-contato-line">${renderWhatsappPhoneButton({
          participanteId: item.participanteId,
          phone: p?.contatoTelefone,
        })}</div>`,
      );
    }
    if (lines.length === 1) {
      lines.push('<div class="arr-artistico-contato-line cell-muted">Sem contato</div>');
    }
    return `<div class="arr-artistico-contato">${lines.join('')}</div>`;
  }

  function bindArtisticoTableActions() {
    bindTableAction('abrir-lead', (item) => openLeadDetailModal(item.id));
    bindTableAction('edit', (item) => openLeadDetailModal(item.id));
    bindTableAction('excluir', (item) => deleteArtisticoLead(item));
    bindTableAction('migrar-artistico', (item) => migrateToArtistico(item.id));

    els.table.querySelectorAll('[data-action="perda-lead"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = items.find((x) => x.id === Number(btn.dataset.id));
        if (item) openPerdaLeadModal(item);
      });
    });

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        openLeadDetailModal(Number(row.dataset.id));
      });
    });

    bindWhatsappChatButtons(els.table, handleOpenWhatsappChat);
  }

  function renderArtisticoTable() {
    if (!items.length) {
      els.table.innerHTML =
        '<tr><td colspan="7" class="cell-empty">Nenhum lead artístico cadastrado.</td></tr>';
      els.summary.textContent =
        'Crie um lead para registrar artista, contato, orçamento e acompanhar a negociação.';
      return;
    }

    els.table.innerHTML = items
      .map((item) => {
        const ref = item.descricao ? truncateText(item.descricao, 40) : '—';
        const obs = item.obs ? truncateText(item.obs, 32) : '';
        const atracaoCell = item.descricao
          ? `<button type="button" class="arr-ref-chip" data-action="abrir-lead" data-id="${item.id}" title="${escapeHtml(item.descricao)}">${escapeHtml(ref)}</button>`
          : '<span class="cell-muted">—</span>';
        const p = getParticipanteById(item.participanteId);
        const seguidores =
          p?.seguidores != null ? formatSeguidores(p.seguidores) : '—';

        return `
        <tr data-id="${item.id}">
          <td class="arr-cell-contato">${renderArtisticoContatoCell(item)}</td>
          <td>${atracaoCell}</td>
          <td><span class="badge ${item.status}">${escapeHtml(etapaLabel(item.status))}</span></td>
          <td class="${p?.seguidores != null ? '' : 'cell-empty'}">${seguidores}</td>
          <td class="cell-money">${item.valorTotal > 0 ? fmtMoney(item.valorTotal) : '—'}</td>
          <td class="${obs ? 'cell-muted' : 'cell-empty'}" title="${obs ? escapeHtml(item.obs) : ''}">${obs || '—'}</td>
          <td class="row-actions row-actions-icons arr-cell-acoes">${renderItemActions(item)}</td>
        </tr>`;
      })
      .join('');

    els.summary.textContent = `${items.length} lead(s) artístico(s)`;
    bindArtisticoTableActions();
  }

  function renderTable() {
    if (isArtisticoScope(leadScope)) {
      renderArtisticoTable();
      return;
    }

    if (!items.length) {
      els.table.innerHTML =
        '<tr><td colspan="5" class="cell-empty">Nenhum registro de arrecadação.</td></tr>';
      els.summary.textContent =
        'Crie leads na arrecadação ou vincule participantes aos espaços para acompanhar os pagamentos.';
      return;
    }

    const groups = groupItemsForTable(items);

    els.table.innerHTML = groups
      .map((group) => {
        const quitado =
          group.valorFalta <= 0 &&
          group.items.every((item) => isVendaEtapaStatus(item.status));
        const obsParts = [
          ...new Set(group.items.map((i) => String(i.obs || '').trim()).filter(Boolean)),
        ];
        const obs = obsParts.length ? truncateText(obsParts.join(' · '), 28) : '';
        const obsTitle = obsParts.join('\n');

        const refsHtml = group.merged
          ? `<div class="arr-refs-inline" title="${escapeHtml(group.items.map((i) => i.descricao).filter(Boolean).join('\n'))}">${group.items
              .map((item, idx) => {
                const label = shortRef(item.descricao);
                const sep =
                  idx > 0 ? '<span class="arr-ref-sep" aria-hidden="true">·</span>' : '';
                return `${sep}<button type="button" class="arr-ref-chip" data-id="${item.id}" title="${escapeHtml(item.descricao || '')}">${escapeHtml(label)}</button>`;
              })
              .join('')}</div>`
          : (() => {
              const item = group.items[0];
              const ref = item.descricao ? truncateText(item.descricao) : '';
              return ref
                ? `<div class="arr-ref" title="${escapeHtml(item.descricao)}">${escapeHtml(ref)}</div>`
                : '<div class="arr-ref cell-empty">—</div>';
            })();

        const statusBadges = group.statuses
          .map(
            (status) =>
              `<span class="badge ${status}">${escapeHtml(etapaLabel(status))}</span>`,
          )
          .join('');

        const singleId = group.merged ? '' : `data-id="${group.items[0].id}"`;

        const acoesHtml = group.merged
          ? `<div class="arr-acoes-merged">${group.items
              .map(
                (item) =>
                  `<div class="arr-acoes-item row-actions-icons">${renderItemActions(item)}</div>`,
              )
              .join('')}</div>`
          : renderItemActions(group.items[0]);

        return `
        <tr class="${group.merged ? 'arr-row-grouped' : ''}" ${singleId}>
          <td class="arr-cell-registro">
            <div class="arr-nome" title="${escapeHtml(group.participanteNome)}">${escapeHtml(group.participanteNome)}</div>
            ${refsHtml}
          </td>
          <td class="arr-cell-situacao">
            <div class="arr-situacao-stack">
              ${renderTipoBadges(group.tipos || [group.tipo])}
              ${statusBadges}
            </div>
          </td>
          <td class="arr-cell-valores cell-money">
            <div class="arr-valores-stack">
              <div class="arr-valor-linha">
                <span class="arr-valor-lbl">Total</span>
                <span class="arr-valor-num">${fmtMoney(group.valorTotal)}</span>
              </div>
              <div class="arr-valor-linha">
                <span class="arr-valor-lbl">Pago</span>
                <span class="arr-valor-num arr-valor-pago">${fmtMoney(group.valorPago)}</span>
              </div>
              <div class="arr-valor-linha">
                <span class="arr-valor-lbl">Falta</span>
                <span class="arr-valor-num ${quitado ? 'arr-valor-quitado' : 'arr-valor-falta'}">${
                  quitado ? 'Quitado' : fmtMoney(group.valorFalta)
                }</span>
              </div>
            </div>
          </td>
          <td class="arr-cell-obs ${obs ? 'cell-muted' : 'cell-empty'}" title="${obsTitle ? escapeHtml(obsTitle) : ''}">${obs || '—'}</td>
          <td class="row-actions row-actions-icons arr-cell-acoes">${acoesHtml}</td>
        </tr>
      `;
      })
      .join('');

    const mergedCount = groups.filter((g) => g.merged).length;
    els.summary.textContent =
      mergedCount > 0
        ? `${groups.length} linha(s) · ${items.length} registro(s) (${mergedCount} agrupada(s))`
        : `${items.length} registro(s) de arrecadação`;

    bindTableAction('edit', (item) => openLeadDetailModal(item.id));
    bindTableAction('migrar-artistico', (item) => migrateToArtistico(item.id));
    bindTableAction('pagamento', (item) => openPagamentoModal(item));
    bindTableAction('perda-lead', (item) => openPerdaLeadModal(item));

    function openLeadFromListClick(e, id) {
      if (e.target.closest('[data-action]')) return;
      if (id) openLeadDetailModal(id);
    }

    els.table.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.arr-ref-chip')) return;
        openLeadFromListClick(e, Number(row.dataset.id));
      });
    });

    els.table.querySelectorAll('tr.arr-row-grouped').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        if (e.target.closest('.arr-ref-chip')) return;
        const firstChip = row.querySelector('.arr-ref-chip');
        if (firstChip) openLeadFromListClick(e, Number(firstChip.dataset.id));
      });
    });

    els.table.querySelectorAll('.arr-ref-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLeadDetailModal(Number(btn.dataset.id));
      });
    });
  }

  function renderDisponiveisTable() {
    if (!els.disponiveisSection || !els.disponiveisTable) return;

    if (viewMode === 'kanban') {
      els.disponiveisSection.classList.add('hidden');
      return;
    }

    if (!espacosDisponiveis.length) {
      els.disponiveisSection.classList.add('hidden');
      return;
    }

    els.disponiveisSection.classList.remove('hidden');
    els.disponiveisSummary.textContent = `${espacosDisponiveis.length} espaço(s) sem participante vinculado`;
    els.disponiveisTable.innerHTML = espacosDisponiveis
      .map(
        (espaco) => `
        <tr>
          <td><strong>${escapeHtml(espaco.label)}</strong></td>
          <td>${escapeHtml(espaco.grupoNome)}</td>
          <td class="cell-money">${espaco.custo != null ? fmtMoney(espaco.custo) : '—'}</td>
          <td class="cell-money">${espaco.valor != null ? fmtMoney(espaco.valor) : '—'}</td>
        </tr>
      `,
      )
      .join('');
  }

  async function saveItem() {
    const form = readForm();
    if (!form.participanteNome && !form.participanteId) {
      alert(isCreateMode ? 'Informe o participante.' : 'Informe o participante ou patrocinador.');
      return;
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';

    const tipoLead = editTipo || createLeadTipo();

    try {
      if (isCreateMode || !editId) {
        const { item } = await createPatrocinio({ ...form, tipo: tipoLead });
        closeModal();
        if (item?.tipo === 'artistico') {
          await switchLeadScope('artistico', { navigate: true });
          await openLeadDetail(item.id, { tipo: 'artistico' });
        } else {
          await loadArrecadacao();
        }
        if (form.proximoContato) onTarefaChanged?.();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  document.querySelectorAll('[data-arr-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const scope = btn.dataset.arrScope || 'comercial';
      if (scope !== leadScope) await switchLeadScope(scope);
      setViewMode(btn.dataset.arrView);
    });
  });
  document.getElementById('btn-arrecadacao-toggle-overview')?.addEventListener('click', () => {
    toggleOverviewVisible('comercial');
  });
  document.getElementById('btn-artistico-toggle-overview')?.addEventListener('click', () => {
    toggleOverviewVisible('artistico');
  });
  els.btnFunilConfig?.addEventListener('click', openFunilModal);
  document.getElementById('btn-funil-config')?.addEventListener('click', openFunilModal);
  document.getElementById('btn-funil-config-artistico')?.addEventListener('click', openFunilModal);
  els.funilBtnCancel?.addEventListener('click', closeFunilModal);
  els.funilBtnSave?.addEventListener('click', saveFunilConfig);
  els.funilBtnAdd?.addEventListener('click', addFunilEtapa);
  els.funilModalBg?.addEventListener('click', (e) => {
    if (e.target === els.funilModalBg) closeFunilModal();
  });
  els.leadWorkspaceBack?.addEventListener('click', closeLeadWorkspace);
  els.leadInteracaoForm?.addEventListener('submit', submitLeadInteracao);
  els.leadTarefaForm?.addEventListener('submit', submitLeadTarefa);
  els.leadOrigemCanal?.addEventListener('change', () => {
    const canalId = Number(els.leadOrigemCanal.value) || null;
    els.leadOrigemCampanha.value = '';
    els.leadOrigemCriativo.value = '';
    renderOrigemSelectOptions();
    saveLeadOrigem({
      marketingCanalId: canalId,
      marketingCampanhaId: null,
      marketingCriativoId: null,
    });
  });
  els.leadOrigemCampanha?.addEventListener('change', () => {
    const campanhaId = Number(els.leadOrigemCampanha.value) || null;
    els.leadOrigemCriativo.value = '';
    renderOrigemSelectOptions();
    saveLeadOrigem({ marketingCampanhaId: campanhaId, marketingCriativoId: null });
  });
  els.leadOrigemCriativo?.addEventListener('change', () => {
    const criativoId = Number(els.leadOrigemCriativo.value) || null;
    saveLeadOrigem({ marketingCriativoId: criativoId });
  });

  PAGE_CONFIG.artistico.ids.btnNew &&
    document
      .getElementById(PAGE_CONFIG.artistico.ids.btnNew)
      ?.addEventListener('click', () => {
        applyLeadScope('artistico');
        openModal(null, 'create');
      });
  PAGE_CONFIG.comercial.ids.btnNew &&
    document
      .getElementById(PAGE_CONFIG.comercial.ids.btnNew)
      ?.addEventListener('click', () => {
        applyLeadScope('comercial');
        openModal(null, 'create');
      });
  els.btnCancel.addEventListener('click', closeModal);
  els.btnSave.addEventListener('click', saveItem);
  els.btnDelete?.addEventListener('click', () => {
    if (editId) deleteArtisticoLead(editId);
  });
  els.migrateArtisticoBtn?.addEventListener('click', () => {
    if (editId) migrateToArtistico(editId);
  });
  els.perdaBtnCancel.addEventListener('click', closePerdaLeadModal);
  els.perdaBtnSave.addEventListener('click', confirmPerdaLead);
  els.perdaMotivo.addEventListener('change', syncPerdaOutroField);
  els.pagamentoBtnCancel.addEventListener('click', closePagamentoModal);
  els.pagamentoBtnSave.addEventListener('click', confirmPagamento);
  els.pagamentoValor.addEventListener('input', (e) => maskValorInput(e.target));
  els.participante.addEventListener('input', syncParticipanteIdFromInput);
  els.participante.addEventListener('change', syncParticipanteIdFromInput);
  els.whatsapp?.addEventListener('input', (e) => maskPhoneInput(e.target));
  els.valorTotal.addEventListener('input', (e) => maskValorInput(e.target));
  els.valorPago.addEventListener('input', (e) => maskValorInput(e.target));

  els.modalBg.addEventListener('click', (e) => {
    if (e.target === els.modalBg) closeModal();
  });

  els.perdaModalBg.addEventListener('click', (e) => {
    if (e.target === els.perdaModalBg) closePerdaLeadModal();
  });

  els.pagamentoModalBg.addEventListener('click', (e) => {
    if (e.target === els.pagamentoModalBg) closePagamentoModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.pagamentoModalBg.classList.contains('open')) closePagamentoModal();
    else if (!els.leadWorkspace?.classList.contains('hidden')) closeLeadWorkspace();
    else if (els.funilModalBg?.classList.contains('open')) closeFunilModal();
    else if (els.perdaModalBg.classList.contains('open')) closePerdaLeadModal();
    else if (els.modalBg.classList.contains('open')) closeModal();
  });

  async function refreshLeadTarefas() {
    if (leadDetailId) await loadLeadDetailTarefas(leadDetailId);
  }

  return {
    loadArrecadacao,
    openLeadDetail,
    refreshLeadTarefas,
    setLeadScope: (scope, opts) => switchLeadScope(scope, opts),
  };
}
