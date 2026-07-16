import {
  fetchMarketingFormularios,
  createMarketingFormulario,
  updateMarketingFormulario,
  deleteMarketingFormulario,
  fetchFormularioRespostas,
  fetchArrecadacaoById,
  updateFormularioResposta,
  deleteFormularioResposta,
  fetchFormularioRespostaInteracoes,
  createFormularioRespostaInteracao,
  deleteFormularioRespostaInteracao,
  fetchMarketingFormularioLogoBlob,
  generateMarketingFormularioIntro,
  generateMarketingFormularioSecao,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, formatPhoneDisplay, isoToDatetimeLocalValue, datetimeLocalToIso, fmtDate } from '../lib/format.js';
import { getCurrentUser } from '../lib/auth.js';
import { getActiveEvento } from '../lib/evento.js';

const FIELD_TYPES = [
  { value: 'text', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'money', label: 'Valor monetário (R$)' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'select', label: 'Lista de opções' },
  { value: 'checkbox', label: 'Sim / Não' },
];

const CLASSIFICACAO_LABELS = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
};

const SELECT_OTHER_VALUE = '__outro__';

const RESPOSTAS_SORT_KEYS = new Set(['dataAtivacao', 'createdAt']);
const DEFAULT_RESPOSTAS_SORT = { key: 'dataAtivacao', dir: 'desc' };

const LISTA_COLUNA_FIXAS = [
  { key: 'nome', label: 'Nome' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'classificacao', label: 'Classificação' },
  { key: 'dataAtivacao', label: 'Ativação' },
  { key: 'createdAt', label: 'Enviado em' },
];

const DEFAULT_COLUNAS_LISTA = {
  fixas: LISTA_COLUNA_FIXAS.map((c) => c.key),
  campos: [],
};

function respostasSortStorageKey(formularioId) {
  return `marketing-form-respostas-sort:${formularioId}`;
}

function readRespostasSort(formularioId) {
  if (!formularioId) return { ...DEFAULT_RESPOSTAS_SORT };
  try {
    const raw = localStorage.getItem(respostasSortStorageKey(formularioId));
    if (!raw) return { ...DEFAULT_RESPOSTAS_SORT };
    const parsed = JSON.parse(raw);
    if (!parsed?.key || !RESPOSTAS_SORT_KEYS.has(parsed.key)) {
      return { ...DEFAULT_RESPOSTAS_SORT };
    }
    return { key: parsed.key, dir: parsed.dir === 'asc' ? 'asc' : 'desc' };
  } catch {
    return { ...DEFAULT_RESPOSTAS_SORT };
  }
}

function writeRespostasSort(formularioId, state) {
  if (!formularioId || !state?.key || !RESPOSTAS_SORT_KEYS.has(state.key)) return;
  try {
    localStorage.setItem(
      respostasSortStorageKey(formularioId),
      JSON.stringify({ key: state.key, dir: state.dir === 'asc' ? 'asc' : 'desc' }),
    );
  } catch {
    /* ignore */
  }
}

const DEFAULT_FORM_BG = '#eef2f6';

function formPublicUrl(slug) {
  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/f\/[^/]*\/?$/, '').replace(/\/+$/, '');
  return `${url.origin}${path}/f/${encodeURIComponent(slug)}`;
}

function defaultCampo(index = 0) {
  return {
    id: `campo_${index + 1}`,
    label: '',
    type: 'text',
    required: true,
    options: [],
  };
}

function cloneColunasLista(source) {
  const base = source && typeof source === 'object' ? source : DEFAULT_COLUNAS_LISTA;
  return {
    fixas: Array.isArray(base.fixas) ? [...base.fixas] : [...DEFAULT_COLUNAS_LISTA.fixas],
    campos: Array.isArray(base.campos) ? [...base.campos] : [],
  };
}

function normalizeColunasListaForCampos(colunasLista, campos) {
  const next = cloneColunasLista(colunasLista);
  const validIds = new Set(campos.map((c) => c.id));
  next.fixas = next.fixas.filter((key) => LISTA_COLUNA_FIXAS.some((c) => c.key === key));
  if (!next.fixas.length) next.fixas = [...DEFAULT_COLUNAS_LISTA.fixas];
  next.campos = next.campos.filter((id) => validIds.has(id));
  return next;
}

function colunasListaFromFormulario(item, campos) {
  if (item?.colunasLista) return normalizeColunasListaForCampos(item.colunasLista, campos);
  const legacyCampoIds = campos.filter((c) => c.showInList).map((c) => c.id);
  return normalizeColunasListaForCampos(
    { fixas: [...DEFAULT_COLUNAS_LISTA.fixas], campos: legacyCampoIds },
    campos,
  );
}

function readColunasListaFromContainer(container, campos) {
  if (!container) return cloneColunasLista();
  const fixas = [];
  container.querySelectorAll('[data-coluna-fixa]:checked').forEach((input) => {
    fixas.push(input.dataset.colunaFixa);
  });
  const campoIds = [];
  container.querySelectorAll('[data-coluna-campo]:checked').forEach((input) => {
    campoIds.push(input.dataset.colunaCampo);
  });
  return normalizeColunasListaForCampos({ fixas, campos: campoIds }, campos);
}

function renderColunasListaEditor(container, listaState, campos) {
  if (!container) return;

  const camposComLabel = campos.filter((campo) => String(campo.label || '').trim());

  const fixasHtml = LISTA_COLUNA_FIXAS.map((coluna) => {
    const checked = listaState.fixas.includes(coluna.key) ? ' checked' : '';
    return `
      <label class="marketing-form-coluna-check">
        <input type="checkbox" data-coluna-fixa="${coluna.key}"${checked} />
        ${escapeHtml(coluna.label)}
      </label>`;
  }).join('');

  const camposHtml = camposComLabel.length
    ? camposComLabel
        .map((campo) => {
          const checked = listaState.campos.includes(campo.id) ? ' checked' : '';
          return `
      <label class="marketing-form-coluna-check">
        <input type="checkbox" data-coluna-campo="${escapeHtml(campo.id)}"${checked} />
        ${escapeHtml(campo.label)}
      </label>`;
        })
        .join('')
    : '<p class="field-hint">Este formulário não tem perguntas configuradas.</p>';

  container.innerHTML = `
    <div class="marketing-form-colunas-group">
      <span class="marketing-form-colunas-group-label">Colunas padrão</span>
      <div class="marketing-form-colunas-checks">${fixasHtml}</div>
    </div>
    <div class="marketing-form-colunas-group">
      <span class="marketing-form-colunas-group-label">Perguntas do formulário</span>
      <p class="field-hint">Se nenhuma pergunta estiver marcada, a lista mostra a coluna <strong>Resumo</strong>.</p>
      <div class="marketing-form-colunas-checks">${camposHtml}</div>
    </div>`;

  const sync = () => {
    const next = readColunasListaFromContainer(container, campos);
    listaState.fixas = next.fixas;
    listaState.campos = next.campos;
  };

  container.querySelectorAll('[data-coluna-fixa], [data-coluna-campo]').forEach((input) => {
    input.addEventListener('change', sync);
  });
}

function defaultSecao(index = 0) {
  return {
    id: `secao_${index + 1}`,
    titulo: '',
    texto: '',
  };
}

function moveListItem(list, index, delta) {
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);
}

function orderButtonsHtml(index, total, prefix) {
  const upDisabled = index === 0 ? ' disabled' : '';
  const downDisabled = index >= total - 1 ? ' disabled' : '';
  return `
    <div class="marketing-form-order-btns" aria-label="Ordenar">
      <button class="tbtn marketing-form-order-btn" type="button" data-action="move-${prefix}-up" data-index="${index}" title="Mover para cima"${upDisabled}>↑</button>
      <button class="tbtn marketing-form-order-btn" type="button" data-action="move-${prefix}-down" data-index="${index}" title="Mover para baixo"${downDisabled}>↓</button>
    </div>`;
}

export function initMarketingFormularios({
  getMarketingData,
  onSummaryChange,
  onRespostasPageChange,
  onOpenWhatsappChat,
}) {
  const els = {
    panel: document.getElementById('marketing-panel-formularios'),
    respostasPage: document.getElementById('marketing-panel-respostas'),
    table: document.getElementById('marketing-table-formularios'),
    btnNew: document.getElementById('btn-marketing-formulario-new'),
    modalBg: document.getElementById('marketing-form-modal-bg'),
    modalTitle: document.getElementById('marketing-form-modal-title'),
    fieldNome: document.getElementById('marketing-form-nome'),
    fieldSlug: document.getElementById('marketing-form-slug'),
    fieldIntro: document.getElementById('marketing-form-intro'),
    fieldIntroAiBrief: document.getElementById('marketing-form-intro-ai-brief'),
    btnIntroAi: document.getElementById('marketing-form-intro-ai'),
    introAiStatus: document.getElementById('marketing-form-intro-ai-status'),
    fieldDescricaoLead: document.getElementById('marketing-form-descricao-lead'),
    fieldTipoLead: document.getElementById('marketing-form-tipo-lead'),
    fieldStatusInicial: document.getElementById('marketing-form-status-inicial'),
    fieldCanal: document.getElementById('marketing-form-canal'),
    fieldCampanha: document.getElementById('marketing-form-campanha'),
    fieldCriativo: document.getElementById('marketing-form-criativo'),
    fieldAtivo: document.getElementById('marketing-form-ativo'),
    fieldLogo: document.getElementById('marketing-form-logo'),
    logoPreviewWrap: document.getElementById('marketing-form-logo-preview-wrap'),
    logoPreview: document.getElementById('marketing-form-logo-preview'),
    logoRemove: document.getElementById('marketing-form-logo-remove'),
    fieldCorFundo: document.getElementById('marketing-form-cor-fundo'),
    fieldCorFundoHex: document.getElementById('marketing-form-cor-fundo-hex'),
    btnCorFundoFromLogo: document.getElementById('marketing-form-cor-fundo-from-logo'),
    btnCorFundoReset: document.getElementById('marketing-form-cor-fundo-reset'),
    logoPickWrap: document.getElementById('marketing-form-logo-pick-wrap'),
    logoPickHint: document.getElementById('marketing-form-logo-pick-hint'),
    camposList: document.getElementById('marketing-form-campos'),
    colunasListaWrap: document.getElementById('marketing-form-colunas-lista'),
    btnAddCampo: document.getElementById('marketing-form-add-campo'),
    secoesList: document.getElementById('marketing-form-secoes'),
    btnAddSecao: document.getElementById('marketing-form-add-secao'),
    btnAddSecaoAi: document.getElementById('marketing-form-add-secao-ai'),
    btnCancel: document.getElementById('marketing-form-cancel'),
    btnSave: document.getElementById('marketing-form-save'),
    btnDelete: document.getElementById('marketing-form-delete'),
    linkPreview: document.getElementById('marketing-form-link'),
    respostasTitle: document.getElementById('marketing-respostas-title'),
    respostasSub: document.getElementById('marketing-respostas-sub'),
    respostasFilters: document.getElementById('marketing-respostas-filters'),
    respostasTableWrap: document.querySelector('.marketing-respostas-table-wrap'),
    respostasTableHead: document.getElementById('marketing-respostas-table-head'),
    respostasTable: document.getElementById('marketing-respostas-table'),
    respostasBack: document.getElementById('marketing-respostas-back'),
    respostasColunasBtn: document.getElementById('marketing-respostas-colunas-btn'),
    respostasColunasModalBg: document.getElementById('marketing-respostas-colunas-modal-bg'),
    respostasColunasListaWrap: document.getElementById('marketing-respostas-colunas-lista'),
    respostasColunasCancel: document.getElementById('marketing-respostas-colunas-cancel'),
    respostasColunasSave: document.getElementById('marketing-respostas-colunas-save'),
    respostaDetailPage: document.getElementById('marketing-panel-resposta-detail'),
    respostaDetailBack: document.getElementById('marketing-resposta-detail-back'),
    respostaDetailTitle: document.getElementById('marketing-resposta-detail-title'),
    respostaDetailMeta: document.getElementById('marketing-resposta-detail-meta'),
    respostaDetailContacts: document.getElementById('marketing-resposta-detail-contacts'),
    respostaTelefone: document.getElementById('marketing-resposta-telefone'),
    respostaTelefoneView: document.getElementById('marketing-resposta-telefone-view'),
    respostaTelefoneEdit: document.getElementById('marketing-resposta-telefone-edit'),
    respostaTelefoneDisplay: document.getElementById('marketing-resposta-telefone-display'),
    respostaContactInstagram: document.getElementById('marketing-resposta-contact-instagram'),
    respostaDetailBadge: document.getElementById('marketing-resposta-detail-badge'),
    respostaDetailBody: document.getElementById('marketing-resposta-detail-body'),
    respostaParticipanteNome: document.getElementById('marketing-resposta-participante-nome'),
    respostaParticipanteInstagram: document.getElementById('marketing-resposta-participante-instagram'),
    respostaParticipanteInstagramOpen: document.getElementById('marketing-resposta-participante-instagram-open'),
    respostaClassificacao: document.getElementById('marketing-resposta-classificacao'),
    respostaDataAtivacao: document.getElementById('marketing-resposta-data-ativacao'),
    respostaInteracoesList: document.getElementById('marketing-resposta-interacoes-list'),
    respostaInteracaoForm: document.getElementById('marketing-resposta-interacao-form'),
    respostaInteracaoTexto: document.getElementById('marketing-resposta-interacao-texto'),
    respostaDetailDelete: document.getElementById('marketing-resposta-detail-delete'),
    respostaDetailCancel: document.getElementById('marketing-resposta-detail-cancel'),
    respostaDetailSave: document.getElementById('marketing-resposta-detail-save'),
  };

  let formularios = [];
  let editId = null;
  let campos = [];
  let secoes = [];
  let colunasLista = cloneColunasLista();
  let respostasColunasDraft = cloneColunasLista();
  let respostasCtx = { formulario: null, respostas: [] };
  let respostaEditId = null;
  let respostaInteracoes = [];
  let respostasPageOpen = false;
  let respostasFilterClassificacao = '';
  let respostasSort = { key: 'dataAtivacao', dir: 'desc' };
  let respostaDetailOpen = false;
  let respostaTelefoneOriginal = '';
  let telefoneEditOpen = false;
  let pendingLogoDataUrl = null;
  let logoPreviewObjectUrl = null;
  let logoPickMode = false;

  function revokeLogoPreviewUrl() {
    if (logoPreviewObjectUrl) {
      URL.revokeObjectURL(logoPreviewObjectUrl);
      logoPreviewObjectUrl = null;
    }
  }

  function setCorFundoFields(value = '') {
    const normalized = /^#[0-9a-fA-F]{6}$/.test(String(value || ''))
      ? String(value).toLowerCase()
      : DEFAULT_FORM_BG;
    if (els.fieldCorFundo) els.fieldCorFundo.value = normalized;
    if (els.fieldCorFundoHex) els.fieldCorFundoHex.value = normalized;
  }

  function readCorFundoValue() {
    const raw = els.fieldCorFundoHex?.value.trim() || els.fieldCorFundo?.value || '';
    if (!raw) return '';
    if (!/^#[0-9a-fA-F]{6}$/.test(raw)) {
      throw new Error('Cor de fundo inválida. Use o formato #RRGGBB.');
    }
    return raw.toLowerCase();
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }

  function logoPreviewReady() {
    const img = els.logoPreview;
    return Boolean(
      img?.src &&
        img.complete &&
        img.naturalWidth > 0 &&
        !els.logoPreviewWrap?.classList.contains('hidden'),
    );
  }

  function updateLogoPickAvailability() {
    const ready = logoPreviewReady();
    if (els.btnCorFundoFromLogo) {
      els.btnCorFundoFromLogo.disabled = !ready;
      if (!ready) setLogoPickMode(false);
    }
  }

  function setLogoPickMode(active) {
    logoPickMode = Boolean(active) && logoPreviewReady();
    els.logoPickWrap?.classList.toggle('marketing-form-logo-pick-wrap--active', logoPickMode);
    els.logoPickHint?.classList.toggle('hidden', !logoPickMode);
    if (els.btnCorFundoFromLogo) {
      els.btnCorFundoFromLogo.textContent = logoPickMode ? 'Cancelar' : 'Pegar da logo';
      els.btnCorFundoFromLogo.classList.toggle('primary', logoPickMode);
    }
  }

  function pickColorFromLogo(clientX, clientY) {
    const img = els.logoPreview;
    if (!img || !logoPreviewReady()) return null;

    const rect = img.getBoundingClientRect();
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const renderedW = naturalW * scale;
    const renderedH = naturalH * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;

    if (localX < 0 || localY < 0 || localX > renderedW || localY > renderedH) return null;

    const pixelX = Math.min(naturalW - 1, Math.max(0, Math.floor((localX / renderedW) * naturalW)));
    const pixelY = Math.min(naturalH - 1, Math.max(0, Math.floor((localY / renderedH) * naturalH)));

    const canvas = document.createElement('canvas');
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    try {
      ctx.drawImage(img, 0, 0, naturalW, naturalH);
      const [r, g, b, a] = ctx.getImageData(pixelX, pixelY, 1, 1).data;
      if (a < 12) return null;
      return rgbToHex(r, g, b);
    } catch {
      return null;
    }
  }

  function bindCorFundoInputs() {
    const syncFromPicker = () => {
      if (!els.fieldCorFundo || !els.fieldCorFundoHex) return;
      els.fieldCorFundoHex.value = els.fieldCorFundo.value.toLowerCase();
    };
    const syncFromHex = () => {
      if (!els.fieldCorFundo || !els.fieldCorFundoHex) return;
      const value = els.fieldCorFundoHex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        els.fieldCorFundo.value = value.toLowerCase();
      }
    };
    els.fieldCorFundo?.addEventListener('input', syncFromPicker);
    els.fieldCorFundoHex?.addEventListener('input', syncFromHex);
    els.btnCorFundoReset?.addEventListener('click', () => {
      setCorFundoFields(DEFAULT_FORM_BG);
      setLogoPickMode(false);
    });
    els.btnCorFundoFromLogo?.addEventListener('click', () => {
      if (!logoPreviewReady()) return;
      setLogoPickMode(!logoPickMode);
    });
    els.logoPreview?.addEventListener('click', (event) => {
      if (!logoPickMode) return;
      const color = pickColorFromLogo(event.clientX, event.clientY);
      if (!color) {
        alert('Não foi possível capturar essa cor. Tente outro ponto da imagem.');
        return;
      }
      setCorFundoFields(color);
      setLogoPickMode(false);
    });
    els.logoPreview?.addEventListener('load', updateLogoPickAvailability);
    els.logoPreview?.addEventListener('error', updateLogoPickAvailability);
  }

  function resetLogoField(item = null) {
    pendingLogoDataUrl = null;
    revokeLogoPreviewUrl();
    setLogoPickMode(false);
    if (els.fieldLogo) els.fieldLogo.value = '';
    if (els.logoRemove) {
      els.logoRemove.checked = false;
      els.logoRemove.disabled = !item?.hasLogo;
    }
    if (!els.logoPreviewWrap || !els.logoPreview) {
      updateLogoPickAvailability();
      return;
    }

    if (item?.hasLogo && item?.id) {
      void loadSavedLogoPreview(item.id);
      return;
    }

    els.logoPreview.removeAttribute('src');
    els.logoPreviewWrap.classList.add('hidden');
    updateLogoPickAvailability();
  }

  async function loadSavedLogoPreview(id) {
    if (!els.logoPreview || !els.logoPreviewWrap) return;
    revokeLogoPreviewUrl();
    try {
      const blob = await fetchMarketingFormularioLogoBlob(id);
      logoPreviewObjectUrl = URL.createObjectURL(blob);
      els.logoPreview.onload = () => updateLogoPickAvailability();
      els.logoPreview.onerror = () => {
        els.logoPreviewWrap.classList.add('hidden');
        updateLogoPickAvailability();
      };
      els.logoPreview.src = logoPreviewObjectUrl;
      els.logoPreviewWrap.classList.remove('hidden');
    } catch {
      els.logoPreview.removeAttribute('src');
      els.logoPreviewWrap.classList.add('hidden');
      updateLogoPickAvailability();
    }
  }

  function bindLogoInput() {
    els.fieldLogo?.addEventListener('change', () => {
      const file = els.fieldLogo.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        alert('A logomarca deve ter no máximo 2 MB.');
        els.fieldLogo.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingLogoDataUrl = String(reader.result || '');
        revokeLogoPreviewUrl();
        if (els.logoPreview) {
          els.logoPreview.onerror = null;
          els.logoPreview.onload = () => updateLogoPickAvailability();
          els.logoPreview.src = pendingLogoDataUrl;
        }
        els.logoPreviewWrap?.classList.remove('hidden');
        updateLogoPickAvailability();
        if (els.logoRemove) {
          els.logoRemove.checked = false;
          els.logoRemove.disabled = false;
        }
      };
      reader.readAsDataURL(file);
    });
    els.logoRemove?.addEventListener('change', () => {
      if (els.logoRemove.checked) {
        pendingLogoDataUrl = null;
        if (els.fieldLogo) els.fieldLogo.value = '';
        setLogoPickMode(false);
        updateLogoPickAvailability();
      }
    });
  }

  function setIntroAiStatus(message = '', type = '') {
    if (!els.introAiStatus) return;
    els.introAiStatus.textContent = message;
    els.introAiStatus.classList.toggle('hidden', !message);
    els.introAiStatus.classList.toggle('is-error', type === 'error');
    els.introAiStatus.classList.toggle('is-loading', type === 'loading');
  }

  async function generateIntroWithAi() {
    const nome = els.fieldNome?.value.trim() || '';
    if (!nome) {
      alert('Informe o nome do formulário antes de gerar o texto.');
      els.fieldNome?.focus();
      return;
    }

    syncCampoFromDom();
    const evento = getActiveEvento();

    if (els.btnIntroAi) els.btnIntroAi.disabled = true;
    setIntroAiStatus('Gerando texto com IA…', 'loading');

    try {
      const res = await generateMarketingFormularioIntro({
        nome,
        descricaoLead: els.fieldDescricaoLead?.value.trim() || nome,
        tipoLead: els.fieldTipoLead?.value || 'patrocinio',
        brief: els.fieldIntroAiBrief?.value.trim() || '',
        introducaoAtual: els.fieldIntro?.value.trim() || '',
        campos: readCamposFromDom().filter((c) => c.label),
        eventoNome: evento?.nome || '',
      });
      if (els.fieldIntro) els.fieldIntro.value = res.texto || '';
      setIntroAiStatus('Texto gerado. Revise antes de salvar.');
    } catch (err) {
      setIntroAiStatus(err.message || 'Não foi possível gerar o texto.', 'error');
    } finally {
      if (els.btnIntroAi) els.btnIntroAi.disabled = false;
    }
  }

  function setSecaoAiStatus(index, message = '', type = '') {
    const el = els.secoesList?.querySelector(`[data-secao-ai-status="${index}"]`);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    el.classList.toggle('is-error', type === 'error');
    el.classList.toggle('is-loading', type === 'loading');
  }

  function setSecoesAiBusy(busy, activeIndex = -1) {
    els.secoesList?.querySelectorAll('[data-action="generate-secao-ai"]').forEach((btn) => {
      btn.disabled = busy;
      btn.classList.toggle('is-loading', busy && Number(btn.dataset.index) === activeIndex);
    });
  }

  async function generateSecaoWithAi(index) {
    const nome = els.fieldNome?.value.trim() || '';
    if (!nome) {
      alert('Informe o nome do formulário antes de gerar o texto.');
      els.fieldNome?.focus();
      return;
    }

    syncSecoesFromDom();
    syncCampoFromDom();
    const secao = secoes[index];
    if (!secao) return;

    const evento = getActiveEvento();
    setSecoesAiBusy(true, index);
    setSecaoAiStatus(index, 'Gerando texto com IA…', 'loading');

    try {
      const res = await generateMarketingFormularioSecao({
        nome,
        descricaoLead: els.fieldDescricaoLead?.value.trim() || nome,
        tipoLead: els.fieldTipoLead?.value || 'patrocinio',
        brief: secao.brief || '',
        tituloAtual: secao.titulo || '',
        textoAtual: secao.texto || '',
        introducao: els.fieldIntro?.value.trim() || '',
        campos: readCamposFromDom().filter((c) => c.label),
        secoes: secoes.map((s) => ({
          titulo: String(s.titulo || '').trim(),
          texto: String(s.texto || '').trim(),
        })),
        secaoIndex: index,
        eventoNome: evento?.nome || '',
      });

      secao.titulo = res.titulo || '';
      secao.texto = res.texto || '';

      const block = els.secoesList?.querySelector(`.marketing-form-secao[data-index="${index}"]`);
      const tituloEl = block?.querySelector('[data-secao="titulo"]');
      const textoEl = block?.querySelector('[data-secao="texto"]');
      if (tituloEl) tituloEl.value = secao.titulo;
      if (textoEl) textoEl.value = secao.texto;

      setSecaoAiStatus(index, 'Texto gerado. Revise antes de salvar.');
    } catch (err) {
      setSecaoAiStatus(index, err.message || 'Não foi possível gerar o texto.', 'error');
    } finally {
      setSecoesAiBusy(false);
    }
  }

  function bindSecoesAi() {
    els.secoesList?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="generate-secao-ai"]');
      if (!btn || btn.disabled) return;
      void generateSecaoWithAi(Number(btn.dataset.index));
    });
  }

  function bindIntroAi() {
    els.btnIntroAi?.addEventListener('click', () => void generateIntroWithAi());
  }

  function renderMarketingSelects(selected = {}) {
    const data = getMarketingData();
    const canais = (data.canais || []).filter((c) => c.ativo);
    const campanhas = (data.campanhas || []).filter((c) => c.ativo);
    const criativos = (data.criativos || []).filter((c) => c.ativo);

    if (els.fieldCanal) {
      els.fieldCanal.innerHTML =
        '<option value="">Nenhuma</option>' +
        canais
          .map(
            (c) =>
              `<option value="${c.id}"${Number(selected.marketingCanalId) === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
    }
    if (els.fieldCampanha) {
      els.fieldCampanha.innerHTML =
        '<option value="">Nenhuma</option>' +
        campanhas
          .map(
            (c) =>
              `<option value="${c.id}"${Number(selected.marketingCampanhaId) === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
    }
    if (els.fieldCriativo) {
      els.fieldCriativo.innerHTML =
        '<option value="">Nenhum</option>' +
        criativos
          .map(
            (c) =>
              `<option value="${c.id}"${Number(selected.marketingCriativoId) === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`,
          )
          .join('');
    }
  }

  function renderSecoesBuilder() {
    if (!els.secoesList) return;
    if (!secoes.length) {
      els.secoesList.innerHTML =
        '<p class="field-hint">Nenhum bloco adicional. O texto de introdução acima continua sendo exibido no topo.</p>';
      return;
    }

    els.secoesList.innerHTML = secoes
      .map((secao, index) => {
        return `
        <div class="marketing-form-secao" data-index="${index}">
          <div class="marketing-form-campo-head">
            <div class="marketing-form-campo-head-left">
              ${orderButtonsHtml(index, secoes.length, 'secao')}
              <strong>Texto ${index + 1}</strong>
            </div>
            <button class="tbtn danger-text" type="button" data-action="remove-secao" data-index="${index}">Remover</button>
          </div>
          <div class="marketing-form-secao-ai">
            <input
              type="text"
              data-secao="brief"
              data-index="${index}"
              value="${escapeHtml(secao.brief || '')}"
              placeholder="Opcional: o que este bloco deve explicar (ex.: critérios de seleção)"
            />
            <button class="tbtn marketing-form-intro-ai-btn" type="button" data-action="generate-secao-ai" data-index="${index}">
              Gerar com IA
            </button>
          </div>
          <p class="field-hint marketing-form-intro-ai-status hidden" data-secao-ai-status="${index}"></p>
          <div class="field">
            <label>Título</label>
            <input type="text" data-secao="titulo" data-index="${index}" value="${escapeHtml(secao.titulo)}" placeholder="Ex.: Como funciona a seleção" />
          </div>
          <div class="field">
            <label>Texto</label>
            <textarea data-secao="texto" data-index="${index}" rows="4" placeholder="Conteúdo exibido ao candidato">${escapeHtml(secao.texto)}</textarea>
          </div>
        </div>`;
      })
      .join('');

    bindSecoesBuilderEvents();
  }

  function bindSecoesBuilderEvents() {
    if (!els.secoesList) return;

    els.secoesList.querySelectorAll('[data-action="remove-secao"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSecoesFromDom();
        secoes.splice(Number(btn.dataset.index), 1);
        renderSecoesBuilder();
      });
    });

    els.secoesList.querySelectorAll('[data-action^="move-secao-"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSecoesFromDom();
        const index = Number(btn.dataset.index);
        moveListItem(secoes, index, btn.dataset.action.endsWith('-up') ? -1 : 1);
        renderSecoesBuilder();
      });
    });

    els.secoesList.querySelectorAll('[data-secao]').forEach((el) => {
      el.addEventListener('input', () => syncSecoesFromDom());
      el.addEventListener('change', () => syncSecoesFromDom());
    });
  }

  function syncSecoesFromDom() {
    if (!els.secoesList) return;
    els.secoesList.querySelectorAll('.marketing-form-secao').forEach((block) => {
      const index = Number(block.dataset.index);
      const secao = secoes[index];
      if (!secao) return;
      const titulo = block.querySelector('[data-secao="titulo"]');
      const texto = block.querySelector('[data-secao="texto"]');
      const brief = block.querySelector('[data-secao="brief"]');
      if (titulo) secao.titulo = titulo.value;
      if (texto) secao.texto = texto.value;
      if (brief) secao.brief = brief.value;
    });
  }

  function readSecoesFromDom() {
    syncSecoesFromDom();
    return secoes
      .map((secao, index) => ({
        ...secao,
        id: secao.id || `secao_${index + 1}`,
        titulo: String(secao.titulo || '').trim(),
        texto: String(secao.texto || '').trim(),
      }))
      .filter((s) => s.titulo || s.texto);
  }

  function renderCamposBuilder() {
    if (!els.camposList) return;
    if (!campos.length) {
      els.camposList.innerHTML =
        '<p class="field-hint">Adicione perguntas específicas para classificar os candidatos.</p>';
      return;
    }

    els.camposList.innerHTML = campos
      .map((campo, index) => {
        const typeOptions = FIELD_TYPES.map(
          (t) =>
            `<option value="${t.value}"${campo.type === t.value ? ' selected' : ''}>${t.label}</option>`,
        ).join('');
        const optionsValue = (campo.options || []).join('\n');
        return `
        <div class="marketing-form-campo" data-index="${index}">
          <div class="marketing-form-campo-head">
            <div class="marketing-form-campo-head-left">
              ${orderButtonsHtml(index, campos.length, 'campo')}
              <strong>Pergunta ${index + 1}</strong>
            </div>
            <button class="tbtn danger-text" type="button" data-action="remove-campo" data-index="${index}">Remover</button>
          </div>
          <div class="field">
            <label>Rótulo</label>
            <input type="text" data-campo="label" data-index="${index}" value="${escapeHtml(campo.label)}" placeholder="Ex.: Tipo de comida oferecida" />
          </div>
          <div class="marketing-form-campo-row">
            <div class="field">
              <label>Tipo</label>
              <select data-campo="type" data-index="${index}">${typeOptions}</select>
            </div>
            <label class="marketing-origem-check marketing-form-required-check">
              <input type="checkbox" data-campo="required" data-index="${index}"${campo.required ? ' checked' : ''} />
              Obrigatório
            </label>
          </div>
          <div class="field${campo.type === 'select' ? '' : ' hidden'}" data-options-wrap="${index}">
            <label>Opções (uma por linha)</label>
            <textarea data-campo="options" data-index="${index}" rows="3" placeholder="Opção 1&#10;Opção 2">${escapeHtml(optionsValue)}</textarea>
            <p class="field-hint">As opções são salvas em ordem alfabética no formulário público.</p>
            <label class="marketing-origem-check marketing-form-allow-other-check${campo.type === 'select' ? '' : ' hidden'}" data-allow-other-wrap="${index}">
              <input type="checkbox" data-campo="allowOther" data-index="${index}"${campo.allowOther ? ' checked' : ''} />
              Permitir opção "Outro" com texto livre
            </label>
          </div>
        </div>`;
      })
      .join('');

    els.camposList.querySelectorAll('[data-action="remove-campo"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncCampoFromDom();
        campos.splice(Number(btn.dataset.index), 1);
        colunasLista = normalizeColunasListaForCampos(colunasLista, campos);
        renderCamposBuilder();
      });
    });

    els.camposList.querySelectorAll('[data-action^="move-campo-"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncCampoFromDom();
        const index = Number(btn.dataset.index);
        moveListItem(campos, index, btn.dataset.action.endsWith('-up') ? -1 : 1);
        renderCamposBuilder();
      });
    });

    els.camposList.querySelectorAll('[data-campo]').forEach((el) => {
      el.addEventListener('input', () => {
        syncCampoFromDom();
        renderColunasListaBuilder();
      });
      el.addEventListener('change', () => {
        syncCampoFromDom();
        renderColunasListaBuilder();
      });
    });

    renderColunasListaBuilder();
  }

  function renderColunasListaBuilder() {
    renderColunasListaEditor(els.colunasListaWrap, colunasLista, campos);
  }

  function syncColunasListaFromDom() {
    if (!els.colunasListaWrap) return;
    const next = readColunasListaFromContainer(els.colunasListaWrap, campos);
    colunasLista.fixas = next.fixas;
    colunasLista.campos = next.campos;
  }

  function readColunasListaFromDom() {
    syncColunasListaFromDom();
    return normalizeColunasListaForCampos(colunasLista, readCamposFromDom().filter((c) => c.label));
  }

  function syncCampoFromDom() {
    if (!els.camposList) return;
    els.camposList.querySelectorAll('.marketing-form-campo').forEach((block) => {
      const index = Number(block.dataset.index);
      const campo = campos[index];
      if (!campo) return;
      const label = block.querySelector('[data-campo="label"]');
      const type = block.querySelector('[data-campo="type"]');
      const required = block.querySelector('[data-campo="required"]');
      const options = block.querySelector('[data-campo="options"]');
      const allowOther = block.querySelector('[data-campo="allowOther"]');
      if (label) campo.label = label.value;
      if (type) campo.type = type.value;
      if (required) campo.required = required.checked;
      if (allowOther) campo.allowOther = allowOther.checked;
      if (options) {
        campo.options = options.value
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean);
      }
      const wrap = block.querySelector(`[data-options-wrap="${index}"]`);
      wrap?.classList.toggle('hidden', campo.type !== 'select');
      block.querySelector(`[data-allow-other-wrap="${index}"]`)?.classList.toggle(
        'hidden',
        campo.type !== 'select',
      );
      if (campo.type !== 'select') campo.allowOther = false;
    });
  }

  function readCamposFromDom() {
    syncCampoFromDom();
    return campos.map((campo, index) => ({
      ...campo,
      id: campo.id || `campo_${index + 1}`,
      label: String(campo.label || '').trim(),
      options: campo.type === 'select' ? campo.options || [] : [],
      allowOther: campo.type === 'select' ? Boolean(campo.allowOther) : false,
    }));
  }

  function openFormModal(item = null) {
    editId = item?.id ?? null;
    campos = item?.campos?.length ? item.campos.map((c) => ({ ...c })) : [defaultCampo()];
    secoes = item?.secoes?.length ? item.secoes.map((s) => ({ ...s })) : [];
    colunasLista = colunasListaFromFormulario(item, campos);

    if (els.modalTitle) {
      els.modalTitle.textContent = editId ? 'Editar formulário' : 'Novo formulário';
    }
    if (els.fieldNome) els.fieldNome.value = item?.nome || '';
    if (els.fieldSlug) els.fieldSlug.value = item?.slug || '';
    if (els.fieldIntro) els.fieldIntro.value = item?.introducao || '';
    if (els.fieldIntroAiBrief) els.fieldIntroAiBrief.value = '';
    setIntroAiStatus();
    if (els.fieldDescricaoLead) els.fieldDescricaoLead.value = item?.descricaoLead || '';
    if (els.fieldTipoLead) els.fieldTipoLead.value = item?.tipoLead || 'patrocinio';
    if (els.fieldStatusInicial) els.fieldStatusInicial.value = item?.statusInicial || 'lead';
    if (els.fieldAtivo) els.fieldAtivo.checked = item?.ativo !== false;
    setCorFundoFields(item?.corFundo || DEFAULT_FORM_BG);

    renderMarketingSelects(item || {});
    renderSecoesBuilder();
    renderCamposBuilder();
    resetLogoField(item);

    if (els.linkPreview) {
      if (item?.slug) {
        const url = formPublicUrl(item.slug);
        els.linkPreview.innerHTML = `Link público: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
        els.linkPreview.classList.remove('hidden');
      } else {
        els.linkPreview.classList.add('hidden');
        els.linkPreview.textContent = '';
      }
    }

    els.btnDelete?.classList.toggle('hidden', !editId);
    els.modalBg?.classList.add('open');
    els.fieldNome?.focus();
  }

  function closeFormModal() {
    els.modalBg?.classList.remove('open');
    editId = null;
    campos = [];
    secoes = [];
    colunasLista = cloneColunasLista();
    setIntroAiStatus();
    revokeLogoPreviewUrl();
    resetLogoField();
  }

  async function readLogoPayload() {
    if (els.logoRemove?.checked) return { removeLogo: true };
    if (pendingLogoDataUrl) return { logoData: pendingLogoDataUrl };
    return null;
  }

  async function saveFormModal() {
    const nome = els.fieldNome?.value.trim() || '';
    if (!nome) {
      alert('Informe o nome do formulário.');
      return;
    }

    const logoPayload = await readLogoPayload();
    let corFundo = '';
    try {
      corFundo = readCorFundoValue();
    } catch (err) {
      alert(err.message);
      return;
    }
    const payload = {
      nome,
      slug: els.fieldSlug?.value.trim() || undefined,
      introducao: els.fieldIntro?.value.trim() || '',
      secoes: readSecoesFromDom(),
      descricaoLead: els.fieldDescricaoLead?.value.trim() || nome,
      tipoLead: els.fieldTipoLead?.value || 'patrocinio',
      statusInicial: els.fieldStatusInicial?.value || 'lead',
      ativo: els.fieldAtivo?.checked !== false,
      marketingCanalId: els.fieldCanal?.value || null,
      marketingCampanhaId: els.fieldCampanha?.value || null,
      marketingCriativoId: els.fieldCriativo?.value || null,
      campos: readCamposFromDom().filter((c) => c.label),
      colunasLista: readColunasListaFromDom(),
      corFundo: corFundo === DEFAULT_FORM_BG ? '' : corFundo,
      ...(logoPayload || {}),
    };

    if (!payload.campos.length) {
      alert('Adicione ao menos uma pergunta ao formulário.');
      return;
    }

    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Salvando…';
    try {
      if (editId) await updateMarketingFormulario(editId, payload);
      else await createMarketingFormulario(payload);
      closeFormModal();
      await loadFormularios();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Salvar';
    }
  }

  async function deleteFormulario(id) {
    if (!confirm('Excluir este formulário? As respostas também serão removidas.')) return;
    try {
      await deleteMarketingFormulario(id);
      await loadFormularios();
    } catch (err) {
      alert(err.message);
    }
  }

  function bindTableActions() {
    els.table?.querySelectorAll('[data-action="edit-form"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = formularios.find((f) => f.id === Number(btn.dataset.id));
        if (item) openFormModal(item);
      });
    });
    els.table?.querySelectorAll('[data-action="delete-form"]').forEach((btn) => {
      btn.addEventListener('click', () => void deleteFormulario(Number(btn.dataset.id)));
    });
    els.table?.querySelectorAll('[data-action="copy-form-link"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = formularios.find((f) => f.id === Number(btn.dataset.id));
        if (!item) return;
        try {
          await navigator.clipboard.writeText(formPublicUrl(item.slug));
          btn.textContent = 'Copiado!';
          setTimeout(() => {
            btn.textContent = 'Copiar link';
          }, 1500);
        } catch {
          alert(formPublicUrl(item.slug));
        }
      });
    });
    els.table?.querySelectorAll('[data-action="view-respostas"]').forEach((btn) => {
      btn.addEventListener('click', () => void openRespostasPage(Number(btn.dataset.id)));
    });
  }

  function setRespostasFlowVisibility() {
    const inFlow = respostasPageOpen || respostaDetailOpen;
    els.respostasPage?.classList.toggle('hidden', !respostasPageOpen || respostaDetailOpen);
    els.respostaDetailPage?.classList.toggle('hidden', !respostaDetailOpen);
    els.panel?.classList.toggle('hidden', inFlow);
    onRespostasPageChange?.(inFlow);
  }

  function setRespostasPageVisible(visible) {
    respostasPageOpen = visible;
    if (!visible) respostaDetailOpen = false;
    setRespostasFlowVisibility();
  }

  function closeRespostasPage() {
    setRespostasPageVisible(false);
  }

  function moneyInputValue(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function maskMoneyInput(el) {
    if (!el) return;
    const digits = el.value.replace(/\D/g, '');
    if (!digits) {
      el.value = '';
      return;
    }
    const val = parseInt(digits, 10) / 100;
    el.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function sortSelectOptions(options = []) {
    return [...options].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }));
  }

  function renderRespostaAnswerField(campo, value) {
    const id = escapeHtml(campo.id);
    const label = escapeHtml(campo.label);
    const required = campo.required ? ' required' : '';
    const reqMark = campo.required ? ' *' : '';

    if (campo.type === 'textarea') {
      return `<div class="field marketing-resposta-answer-field">
        <label for="resposta-campo-${id}">${label}${reqMark}</label>
        <textarea id="resposta-campo-${id}" data-campo-id="${id}" rows="4"${required}>${escapeHtml(value ?? '')}</textarea>
      </div>`;
    }

    if (campo.type === 'select') {
      const options = sortSelectOptions(campo.options || []);
      const stringValue = value == null ? '' : String(value).trim();
      const inOptions = options.includes(stringValue);
      const selectedValue = inOptions ? stringValue : campo.allowOther && stringValue ? SELECT_OTHER_VALUE : '';
      const otherValue = !inOptions && stringValue ? stringValue : '';
      const opts = options
        .map((option) => {
          const opt = escapeHtml(option);
          return `<option value="${opt}"${selectedValue === option ? ' selected' : ''}>${opt}</option>`;
        })
        .join('');
      const otherOption = campo.allowOther
        ? `<option value="${SELECT_OTHER_VALUE}"${selectedValue === SELECT_OTHER_VALUE ? ' selected' : ''}>Outro</option>`
        : '';
      const otherField = campo.allowOther
        ? `<input
            type="text"
            class="marketing-resposta-select-other${selectedValue === SELECT_OTHER_VALUE ? '' : ' hidden'}"
            data-outro-input="${id}"
            value="${escapeHtml(otherValue)}"
            placeholder="Descreva a resposta"
          />`
        : '';
      return `<div class="field marketing-resposta-answer-field">
        <label for="resposta-campo-${id}">${label}${reqMark}</label>
        <select id="resposta-campo-${id}" data-campo-id="${id}" data-select-other="${campo.allowOther ? '1' : '0'}"${required}>
          <option value="">Selecione uma opção</option>
          ${opts}
          ${otherOption}
        </select>
        ${otherField}
      </div>`;
    }

    if (campo.type === 'checkbox') {
      const isYes = value === true || value === 'true' || value === 1 || value === '1' || value === 'sim';
      const isNo = value === false || value === 'false' || value === 0 || value === '0' || value === 'nao';
      return `<div class="field marketing-resposta-answer-field marketing-resposta-answer-field--yesno">
        <span class="marketing-resposta-answer-label">${label}${reqMark}</span>
        <div class="marketing-resposta-yesno" role="radiogroup" aria-label="${label}">
          <label class="marketing-resposta-yesno-option">
            <input type="radio" name="resposta-${id}" value="sim"${isYes ? ' checked' : ''}${required && !isYes && !isNo ? ' required' : ''} />
            <span>Sim</span>
          </label>
          <label class="marketing-resposta-yesno-option">
            <input type="radio" name="resposta-${id}" value="nao"${isNo ? ' checked' : ''} />
            <span>Não</span>
          </label>
        </div>
      </div>`;
    }

    if (campo.type === 'money') {
      return `<div class="field marketing-resposta-answer-field">
        <label for="resposta-campo-${id}">${label}${reqMark}</label>
        <input id="resposta-campo-${id}" data-campo-id="${id}" data-money="1" type="text" inputmode="decimal" placeholder="0,00" value="${escapeHtml(moneyInputValue(value))}"${required} />
      </div>`;
    }

    const inputType =
      campo.type === 'email' ? 'email' : campo.type === 'number' ? 'number' : campo.type === 'phone' ? 'tel' : 'text';
    const phoneAttrs =
      inputType === 'tel' ? ' inputmode="tel" data-phone="1" placeholder="(00) 00000-0000"' : '';
    return `<div class="field marketing-resposta-answer-field">
      <label for="resposta-campo-${id}">${label}${reqMark}</label>
      <input id="resposta-campo-${id}" data-campo-id="${id}" type="${inputType}" value="${escapeHtml(value ?? '')}"${required}${phoneAttrs} />
    </div>`;
  }

  function bindRespostaAnswerFields() {
    els.respostaDetailBody?.querySelectorAll('[data-select-other="1"]').forEach((select) => {
      const campoId = select.dataset.campoId;
      const otherInput = els.respostaDetailBody?.querySelector(`[data-outro-input="${campoId}"]`);
      const sync = () => {
        const showOther = select.value === SELECT_OTHER_VALUE;
        otherInput?.classList.toggle('hidden', !showOther);
        if (showOther) otherInput?.focus();
      };
      select.addEventListener('change', sync);
      sync();
    });

    els.respostaDetailBody?.querySelectorAll('[data-money="1"]').forEach((input) => {
      input.addEventListener('input', () => maskMoneyInput(input));
    });

    els.respostaDetailBody?.querySelectorAll('[data-phone="1"]').forEach((input) => {
      input.addEventListener('input', () => maskPhoneInput(input));
    });
  }

  function readRespostasFromDom(campos) {
    const respostas = {};
    for (const campo of campos) {
      if (campo.type === 'checkbox') {
        const checked = els.respostaDetailBody?.querySelector(`input[name="resposta-${campo.id}"]:checked`);
        if (checked) respostas[campo.id] = checked.value === 'sim';
        continue;
      }

      const el = els.respostaDetailBody?.querySelector(`[data-campo-id="${campo.id}"]`);
      if (!el) continue;

      if (campo.type === 'select') {
        if (el.value === SELECT_OTHER_VALUE) {
          const other = els.respostaDetailBody?.querySelector(`[data-outro-input="${campo.id}"]`);
          respostas[campo.id] = String(other?.value || '').trim();
        } else {
          respostas[campo.id] = el.value;
        }
        continue;
      }

      if (campo.type === 'money') {
        const raw = String(el.value || '').trim();
        if (!raw) {
          respostas[campo.id] = '';
          continue;
        }
        const digits = raw.replace(/\D/g, '');
        respostas[campo.id] = digits ? parseInt(digits, 10) / 100 : '';
        continue;
      }

      respostas[campo.id] = el.value;
    }
    return respostas;
  }

  function syncRespostaInstagramOpenBtn() {
    const btn = els.respostaParticipanteInstagramOpen;
    if (!btn) return;
    const url = instagramProfileUrl(els.respostaParticipanteInstagram?.value || '');
    if (!url) {
      btn.hidden = true;
      btn.setAttribute('href', '#');
      btn.setAttribute('aria-disabled', 'true');
      return;
    }
    btn.hidden = false;
    btn.href = url;
    btn.removeAttribute('aria-disabled');
  }

  function renderRespostaAnswersEditor(form, resposta) {
    if (!els.respostaDetailBody) return;

    if (els.respostaParticipanteNome) {
      els.respostaParticipanteNome.value = resposta.participanteNome || '';
    }
    if (els.respostaParticipanteInstagram) {
      els.respostaParticipanteInstagram.value = resposta.participanteInstagram || '';
    }
    syncRespostaInstagramOpenBtn();

    const campos = form?.campos || [];
    const fieldsHtml = campos.map((campo) =>
      renderRespostaAnswerField(campo, resposta.respostas?.[campo.id]),
    );

    els.respostaDetailBody.innerHTML = fieldsHtml.length
      ? fieldsHtml.join('')
      : '<p class="marketing-resposta-answers-empty">Este formulário não possui perguntas adicionais além dos dados de contato.</p>';

    bindRespostaAnswerFields();
  }

  function syncRespostaDetailTitle() {
    if (!els.respostaDetailTitle) return;
    const nome = els.respostaParticipanteNome?.value.trim();
    els.respostaDetailTitle.textContent = nome || 'Candidato';
  }

  function maskPhoneInput(el) {
    if (!el) return;
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

  function readDataAtivacaoIso() {
    const iso = datetimeLocalToIso(els.respostaDataAtivacao?.value);
    if (!iso) {
      throw new Error('Informe a data de ativação do lead.');
    }
    return iso;
  }

  function setDataAtivacaoInput(resposta) {
    if (!els.respostaDataAtivacao) return;
    const source = resposta?.dataAtivacao || resposta?.createdAt || resposta?.leadCreatedAt || '';
    els.respostaDataAtivacao.value = isoToDatetimeLocalValue(source);
  }

  function buildRespostaUpdatePayload(extra = {}) {
    const campos = respostasCtx.formulario?.campos || [];
    const nome = els.respostaParticipanteNome?.value.trim() || '';
    if (!nome) {
      throw new Error('Informe o nome do candidato.');
    }
    const resposta = getRespostaAtual();
    return {
      classificacao: els.respostaClassificacao?.value || 'pendente',
      participanteId: resposta?.participanteId || undefined,
      participanteNome: nome,
      participanteInstagram: els.respostaParticipanteInstagram?.value.trim() || '',
      participanteTelefone: readTelefoneDigits(),
      respostas: readRespostasFromDom(campos),
      dataAtivacao: readDataAtivacaoIso(),
      atualizarLead: true,
      ...extra,
    };
  }

  function renderRespostaInteracoesLoading(message = 'Carregando discussão…') {
    if (!els.respostaInteracoesList) return;
    els.respostaInteracoesList.innerHTML = `<p class="cell-muted marketing-resposta-interacoes-empty">${escapeHtml(message)}</p>`;
  }

  function renderRespostaInteracaoAuthor(interacao) {
    if (interacao.userName) return interacao.userName;
    if (interacao.userId) return 'Usuário';
    return 'Nota anterior';
  }

  function canDeleteRespostaInteracao(interacao, currentUserId) {
    if (!currentUserId) return false;
    if (!interacao.userId) return true;
    return Number(interacao.userId) === Number(currentUserId);
  }

  function renderRespostaInteracoesList() {
    if (!els.respostaInteracoesList) return;

    if (!respostaInteracoes.length) {
      els.respostaInteracoesList.innerHTML =
        '<p class="cell-muted marketing-resposta-interacoes-empty">Nenhuma mensagem ainda. Inicie a discussão sobre esta candidatura.</p>';
      return;
    }

    const currentUserId = getCurrentUser()?.id;
    els.respostaInteracoesList.innerHTML = respostaInteracoes
      .map((interacao) => {
        const isOwn = currentUserId && Number(interacao.userId) === Number(currentUserId);
        const canDelete = canDeleteRespostaInteracao(interacao, currentUserId);
        const deleteBtn = canDelete
          ? `<button
              class="tbtn danger-text marketing-resposta-interacao-delete"
              type="button"
              data-action="delete-interacao"
              data-id="${interacao.id}"
              title="Excluir mensagem"
              aria-label="Excluir mensagem"
            >Excluir</button>`
          : '';
        return `
          <article class="marketing-resposta-interacao-item${isOwn ? ' marketing-resposta-interacao-item--own' : ''}" data-interacao-id="${interacao.id}">
            <header class="marketing-resposta-interacao-head">
              <span class="marketing-resposta-interacao-autor">${escapeHtml(renderRespostaInteracaoAuthor(interacao))}</span>
              <div class="marketing-resposta-interacao-head-right">
                <time class="cell-muted" datetime="${escapeHtml(interacao.criadoEm || '')}">${escapeHtml(fmtDate(interacao.criadoEm))}</time>
                ${deleteBtn}
              </div>
            </header>
            <p class="marketing-resposta-interacao-texto">${escapeHtml(interacao.texto)}</p>
          </article>`;
      })
      .join('');

    els.respostaInteracoesList.scrollTop = els.respostaInteracoesList.scrollHeight;
  }

  async function loadRespostaInteracoes(respostaId) {
    if (!respostaId) {
      respostaInteracoes = [];
      renderRespostaInteracoesList();
      return;
    }
    renderRespostaInteracoesLoading();
    try {
      const data = await fetchFormularioRespostaInteracoes(respostaId);
      respostaInteracoes = data.interacoes || [];
      renderRespostaInteracoesList();
    } catch (err) {
      renderRespostaInteracoesLoading(err.message || 'Não foi possível carregar a discussão.');
    }
  }

  async function deleteRespostaInteracao(interacaoId) {
    if (!respostaEditId || !interacaoId) return;
    if (!confirm('Excluir esta mensagem da discussão?')) return;

    try {
      await deleteFormularioRespostaInteracao(respostaEditId, interacaoId);
      respostaInteracoes = respostaInteracoes.filter((item) => Number(item.id) !== Number(interacaoId));
      renderRespostaInteracoesList();
    } catch (err) {
      alert(err.message || 'Não foi possível excluir a mensagem.');
    }
  }

  async function submitRespostaInteracao(event) {
    event.preventDefault();
    if (!respostaEditId) return;

    const texto = els.respostaInteracaoTexto?.value.trim();
    if (!texto) {
      alert('Informe a mensagem.');
      return;
    }

    const btn = els.respostaInteracaoForm?.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando…';
    }

    try {
      const { interacao } = await createFormularioRespostaInteracao(respostaEditId, { texto });
      if (interacao) {
        respostaInteracoes = [...respostaInteracoes, interacao];
        renderRespostaInteracoesList();
      }
      if (els.respostaInteracaoTexto) els.respostaInteracaoTexto.value = '';
    } catch (err) {
      alert(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enviar';
      }
    }
  }

  function readTelefoneDigits() {
    return String(els.respostaTelefone?.value || '').replace(/\D/g, '').slice(0, 11);
  }

  function setTelefoneViewMode(editing) {
    telefoneEditOpen = Boolean(editing);
    els.respostaTelefoneView?.classList.toggle('hidden', telefoneEditOpen);
    els.respostaTelefoneEdit?.classList.toggle('hidden', !telefoneEditOpen);
    if (telefoneEditOpen) {
      requestAnimationFrame(() => {
        els.respostaTelefone?.focus();
        els.respostaTelefone?.select();
      });
    }
  }

  function updateTelefoneDisplay(phone) {
    if (!els.respostaTelefoneDisplay) return;
    const display = phone ? formatTelefoneDisplay(phone) : '—';
    els.respostaTelefoneDisplay.textContent = display;
    const waBtn = els.respostaTelefoneView?.querySelector('[data-action="open-marketing-whatsapp"]');
    if (waBtn) waBtn.disabled = !phone;
  }

  function setTelefoneInputValue(phone) {
    if (!els.respostaTelefone) return;
    els.respostaTelefone.value = phone ? formatPhoneDisplay(phone) || phone : '';
    respostaTelefoneOriginal = readTelefoneDigits();
    updateTelefoneDisplay(phone);
  }

  function openTelefoneEditor() {
    const resposta = getRespostaAtual();
    setTelefoneInputValue(resposta?.participanteTelefone || '');
    setTelefoneViewMode(true);
  }

  function cancelTelefoneEditor() {
    const resposta = getRespostaAtual();
    setTelefoneInputValue(resposta?.participanteTelefone || '');
    setTelefoneViewMode(false);
  }

  async function confirmTelefoneEditor() {
    const saved = await saveRespostaTelefone();
    if (saved) setTelefoneViewMode(false);
  }

  function telefoneFoiAlterado() {
    return readTelefoneDigits() !== respostaTelefoneOriginal;
  }

  function applyRespostaAtualizada(updated) {
    if (!updated) return;
    const idx = respostasCtx.respostas.findIndex((r) => Number(r.id) === Number(updated.id));
    if (idx >= 0) respostasCtx.respostas[idx] = { ...respostasCtx.respostas[idx], ...updated };
    if (els.respostaDetailTitle) {
      els.respostaDetailTitle.textContent = updated.participanteNome || 'Candidato';
    }
    if (els.respostaParticipanteNome) els.respostaParticipanteNome.value = updated.participanteNome || '';
    if (els.respostaParticipanteInstagram) {
      els.respostaParticipanteInstagram.value = updated.participanteInstagram || '';
    }
    syncRespostaInstagramOpenBtn();
    setTelefoneInputValue(updated.participanteTelefone || '');
    if (!telefoneEditOpen) updateTelefoneDisplay(updated.participanteTelefone || '');
    setDataAtivacaoInput(updated);
    renderRespostasSub();
    renderRespostasTableBody();
  }

  async function saveRespostaTelefone({ silent = false } = {}) {
    if (!respostaEditId) return false;
    const digits = readTelefoneDigits();
    if (!digits) {
      if (!silent) alert('Informe um telefone ou WhatsApp válido.');
      return false;
    }
    if (!telefoneFoiAlterado()) return true;

    try {
      let payload;
      try {
        payload = buildRespostaUpdatePayload();
      } catch (err) {
        if (!silent) alert(err.message);
        return false;
      }
      const { resposta: updated } = await updateFormularioResposta(respostaEditId, payload);
      applyRespostaAtualizada(updated);
      return true;
    } catch (err) {
      if (!silent) alert(err.message || 'Não foi possível salvar o telefone.');
      return false;
    }
  }

  function getRespostaAtual() {
    if (!respostaEditId) return null;
    return respostasCtx.respostas.find((r) => Number(r.id) === Number(respostaEditId)) || null;
  }

  async function resolveRespostaParticipanteId(resposta) {
    let participanteId = Number(resposta?.participanteId);
    if (Number.isInteger(participanteId) && participanteId > 0) return participanteId;

    const arrecadacaoId = Number(resposta?.arrecadacaoId);
    if (!Number.isInteger(arrecadacaoId) || arrecadacaoId < 1) return null;

    try {
      const data = await fetchArrecadacaoById(arrecadacaoId);
      participanteId = Number(data?.item?.participanteId ?? data?.participanteId);
      if (Number.isInteger(participanteId) && participanteId > 0) {
        resposta.participanteId = participanteId;
        return participanteId;
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  async function handleOpenWhatsappFromResposta(resposta) {
    if (typeof onOpenWhatsappChat !== 'function') return;
    if (telefoneFoiAlterado()) {
      const saved = await saveRespostaTelefone();
      if (!saved) return;
      resposta = getRespostaAtual();
      if (!resposta) return;
    }
    const participanteId = await resolveRespostaParticipanteId(resposta);
    if (!participanteId) {
      alert(
        'Não foi possível abrir a conversa. Verifique se o lead está vinculado a um participante com WhatsApp cadastrado.',
      );
      return;
    }
    await onOpenWhatsappChat(participanteId);
  }

  function formatInstagramDisplay(ig) {
    if (!ig) return '';
    const handle = String(ig).trim();
    return handle.startsWith('@') ? handle : `@${handle.replace(/^@+/, '')}`;
  }

  function instagramProfileUrl(ig) {
    const handle = String(ig || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/\/.*$/, '')
      .split('/')[0];
    if (!handle) return '';
    return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  }

  function renderInstagramContact(ig) {
    if (!els.respostaContactInstagram) return;
    if (!ig) {
      els.respostaContactInstagram.innerHTML = '';
      return;
    }
    els.respostaContactInstagram.innerHTML = renderInstagramChip(ig);
  }

  function renderInstagramChip(ig) {
    if (!ig) return '';
    const url = instagramProfileUrl(ig);
    const label = formatInstagramDisplay(ig);
    const inner = `<span class="marketing-resposta-contact-chip-label">Instagram</span><span class="marketing-resposta-contact-chip-value">${escapeHtml(label)}</span>`;
    if (!url) {
      return `<span class="marketing-resposta-contact-chip marketing-resposta-contact-chip--ig marketing-resposta-contact-chip--static">${inner}</span>`;
    }
    return `<a class="marketing-resposta-contact-chip marketing-resposta-contact-chip--ig" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }

  function renderTable() {
    if (!els.table) return;
    els.table.innerHTML = formularios.length
      ? formularios
          .map(
            (f) => `
        <tr>
          <td><strong>${escapeHtml(f.nome)}</strong></td>
          <td>${f.ativo ? 'Ativo' : 'Inativo'}</td>
          <td>${f.totalRespostas || 0}${f.pendentes ? ` <span class="marketing-form-pendentes">(${f.pendentes} pendente${f.pendentes === 1 ? '' : 's'})</span>` : ''}</td>
          <td class="row-actions">
            <button class="tbtn" type="button" data-action="view-respostas" data-id="${f.id}">Respostas</button>
            <button class="tbtn" type="button" data-action="copy-form-link" data-id="${f.id}">Copiar link</button>
            <button class="tbtn" type="button" data-action="edit-form" data-id="${f.id}">Editar</button>
            <button class="tbtn danger-text" type="button" data-action="delete-form" data-id="${f.id}">Excluir</button>
          </td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="cell-empty">Nenhum formulário cadastrado.</td></tr>';

    onSummaryChange?.(
      `${formularios.length} formulário(s) · envie o link para candidatos responderem e classifique as respostas aqui`,
    );
    bindTableActions();
  }

  function formatRespostaPlain(campo, value) {
    if (value == null || value === '') return '';
    if (campo?.type === 'checkbox') return value ? 'Sim' : 'Não';
    if (campo?.type === 'money') return fmtMoney(value);
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function buildResumo(resposta, campos, maxLen = 140) {
    const parts = (campos || [])
      .map((campo) => {
        const plain = formatRespostaPlain(campo, resposta.respostas?.[campo.id]);
        return plain ? `${campo.label}: ${plain}` : '';
      })
      .filter(Boolean);
    const text = parts.join(' · ') || '—';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }

  function openRespostaDetail(resposta) {
    respostaEditId = resposta.id;
    respostaDetailOpen = true;
    const form = respostasCtx.formulario;

    if (els.respostaDetailTitle) {
      els.respostaDetailTitle.textContent = resposta.participanteNome || 'Candidato';
    }
    if (els.respostaDetailMeta) {
      const metaParts = [];
      if (form?.nome) metaParts.push(form.nome);
      if (resposta.createdAt) {
        metaParts.push(`Enviado em ${new Date(resposta.createdAt).toLocaleString('pt-BR')}`);
      }
      els.respostaDetailMeta.textContent = metaParts.join(' · ');
    }
    setTelefoneInputValue(resposta.participanteTelefone || '');
    setTelefoneViewMode(false);
    if (els.respostaContactInstagram) els.respostaContactInstagram.innerHTML = '';
    if (els.respostaDetailBadge) {
      const classif = resposta.classificacao || 'pendente';
      els.respostaDetailBadge.hidden = false;
      els.respostaDetailBadge.className = `marketing-resposta-head-badge marketing-classif marketing-classif--${classif}`;
      els.respostaDetailBadge.textContent = CLASSIFICACAO_LABELS[classif] || classif;
    }
    if (els.respostaClassificacao) {
      els.respostaClassificacao.value = resposta.classificacao || 'pendente';
    }
    setDataAtivacaoInput(resposta);
    if (els.respostaInteracaoTexto) els.respostaInteracaoTexto.value = '';
    void loadRespostaInteracoes(resposta.id);
    renderRespostaAnswersEditor(form, resposta);

    setRespostasFlowVisibility();
  }

  function closeRespostaDetail() {
    respostaDetailOpen = false;
    respostaEditId = null;
    respostaInteracoes = [];
    telefoneEditOpen = false;
    if (els.respostaInteracaoTexto) els.respostaInteracaoTexto.value = '';
    renderRespostaInteracoesList();
    setRespostasFlowVisibility();
  }

  async function saveRespostaDetail() {
    if (!respostaEditId) return;
    els.respostaDetailSave.disabled = true;
    try {
      const digits = readTelefoneDigits();
      if (!digits) {
        alert('Informe um telefone ou WhatsApp válido.');
        return;
      }
      let payload;
      try {
        payload = buildRespostaUpdatePayload({
          statusLead: els.respostaClassificacao?.value === 'reprovado' ? 'perda' : undefined,
        });
      } catch (err) {
        alert(err.message);
        return;
      }
      const { resposta: updated } = await updateFormularioResposta(respostaEditId, payload);
      applyRespostaAtualizada(updated);
      closeRespostaDetail();
      if (respostasCtx.formulario?.id) {
        await openRespostasPage(respostasCtx.formulario.id, { reload: true });
      }
      await loadFormularios();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      els.respostaDetailSave.disabled = false;
    }
  }

  async function deleteResposta(respostaId) {
    const id = Number(respostaId);
    const resposta = respostasCtx.respostas.find((r) => Number(r.id) === id);
    const nome = resposta?.participanteNome || 'esta resposta';
    if (
      !confirm(
        `Excluir a resposta de "${nome}"?\n\nO lead vinculado no marketing não será removido automaticamente.`,
      )
    ) {
      return;
    }

    const deleteBtn = els.respostasTable?.querySelector(`[data-action="delete-resposta"][data-id="${id}"]`);
    if (deleteBtn) deleteBtn.disabled = true;

    try {
      await deleteFormularioResposta(id);
      if (respostaEditId === id) closeRespostaDetail();
      if (respostasCtx.formulario?.id) {
        await openRespostasPage(respostasCtx.formulario.id, { reload: true });
      }
      await loadFormularios();
    } catch (err) {
      alert(err.message || 'Não foi possível excluir a resposta.');
    } finally {
      if (deleteBtn) deleteBtn.disabled = false;
    }
  }

  function bindRespostasTableActions() {
    if (els.respostasTable?.dataset.actionsBound === '1') return;
    if (els.respostasTable) els.respostasTable.dataset.actionsBound = '1';

    els.respostasTable?.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('[data-action="delete-resposta"]');
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        void deleteResposta(Number(deleteBtn.dataset.id));
        return;
      }

      const openBtn = event.target.closest('[data-action="open-resposta"]');
      if (openBtn) {
        event.preventDefault();
        event.stopPropagation();
        const resposta = respostasCtx.respostas.find((r) => Number(r.id) === Number(openBtn.dataset.id));
        if (resposta) openRespostaDetail(resposta);
        return;
      }

      const row = event.target.closest('.marketing-resposta-row');
      if (!row || event.target.closest('button, a')) return;
      const resposta = respostasCtx.respostas.find((r) => Number(r.id) === Number(row.dataset.id));
      if (resposta) openRespostaDetail(resposta);
    });
  }

  function respostaAtivacaoIso(resposta) {
    return resposta?.dataAtivacao || resposta?.createdAt || resposta?.leadCreatedAt || null;
  }

  function formatRespostaData(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
  }

  function getRespostasVisiveis() {
    let list = respostasCtx.respostas || [];
    if (respostasFilterClassificacao) {
      list = list.filter(
        (r) => (r.classificacao || 'pendente') === respostasFilterClassificacao,
      );
    }
    if (!respostasSort.key) return list;

    const dir = respostasSort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const valueA =
        respostasSort.key === 'dataAtivacao'
          ? respostaAtivacaoIso(a)
          : respostasSort.key === 'createdAt'
            ? a.createdAt
            : null;
      const valueB =
        respostasSort.key === 'dataAtivacao'
          ? respostaAtivacaoIso(b)
          : respostasSort.key === 'createdAt'
            ? b.createdAt
            : null;
      const timeA = valueA ? new Date(valueA).getTime() : 0;
      const timeB = valueB ? new Date(valueB).getTime() : 0;
      if (timeA !== timeB) return (timeA - timeB) * dir;
      return (Number(b.id) - Number(a.id)) * dir;
    });
  }

  function updateRespostasFiltersUi() {
    els.respostasFilters?.querySelectorAll('[data-respostas-filter]').forEach((btn) => {
      const active = btn.dataset.respostasFilter === respostasFilterClassificacao;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function getRespostasListConfig(formulario) {
    const campos = formulario?.campos || [];
    const colunas = colunasListaFromFormulario(formulario, campos);
    const fixas = colunas.fixas.length ? colunas.fixas : [...DEFAULT_COLUNAS_LISTA.fixas];
    const campoMap = new Map(campos.map((c) => [c.id, c]));
    const listCols = colunas.campos.length
      ? colunas.campos.map((id) => campoMap.get(id)).filter(Boolean)
      : null;
    return { fixas, listCols };
  }

  function respostasTableColspan() {
    const { fixas, listCols } = getRespostasListConfig(respostasCtx.formulario);
    const dynamicCount = listCols ? listCols.length : 1;
    return fixas.length + dynamicCount + 1;
  }

  function renderRespostaListCell(campo, resposta) {
    const text = formatRespostaPlain(campo, resposta.respostas?.[campo.id]) || '—';
    return escapeHtml(text);
  }

  function renderRespostaFixedCell(key, resposta) {
    const ativacaoIso = respostaAtivacaoIso(resposta);
    switch (key) {
      case 'nome':
        return `<td class="marketing-resposta-nome"><strong>${escapeHtml(resposta.participanteNome)}</strong></td>`;
      case 'telefone':
        return `<td class="marketing-resposta-telefone">${escapeHtml(formatTelefoneDisplay(resposta.participanteTelefone))}</td>`;
      case 'classificacao':
        return `<td><span class="marketing-classif marketing-classif--${resposta.classificacao}">${CLASSIFICACAO_LABELS[resposta.classificacao] || resposta.classificacao}</span></td>`;
      case 'dataAtivacao':
        return `<td class="marketing-resposta-data marketing-resposta-ativacao">${escapeHtml(formatRespostaData(ativacaoIso))}</td>`;
      case 'createdAt':
        return `<td class="marketing-resposta-data">${escapeHtml(formatRespostaData(resposta.createdAt))}</td>`;
      default:
        return '';
    }
  }

  function renderRespostaFixedHeader(key) {
    const coluna = LISTA_COLUNA_FIXAS.find((c) => c.key === key);
    if (!coluna) return '';
    if (key === 'dataAtivacao') {
      const sortClass =
        respostasSort.key === 'dataAtivacao'
          ? ` th-sort--${respostasSort.dir === 'asc' ? 'asc' : 'desc'}`
          : '';
      return `<th class="th-sortable${sortClass}" data-sort="dataAtivacao" aria-sort="${respostasSort.key === 'dataAtivacao' ? (respostasSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${escapeHtml(coluna.label)}</th>`;
    }
    if (key === 'createdAt') {
      const sortClass =
        respostasSort.key === 'createdAt'
          ? ` th-sort--${respostasSort.dir === 'asc' ? 'asc' : 'desc'}`
          : '';
      return `<th class="th-sortable${sortClass}" data-sort="createdAt" aria-sort="${respostasSort.key === 'createdAt' ? (respostasSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${escapeHtml(coluna.label)}</th>`;
    }
    return `<th>${escapeHtml(coluna.label)}</th>`;
  }

  function renderRespostasTableHead() {
    if (!els.respostasTableHead) return;
    const { fixas, listCols } = getRespostasListConfig(respostasCtx.formulario);
    const fixedHeaders = fixas.map((key) => renderRespostaFixedHeader(key)).join('');
    const dynamicHeaders = listCols
      ? listCols
          .map((campo) => `<th class="marketing-resposta-col-campo">${escapeHtml(campo.label)}</th>`)
          .join('')
      : '<th>Resumo</th>';

    els.respostasTableHead.innerHTML = `
      ${fixedHeaders}
      ${dynamicHeaders}
      <th>Ações</th>`;
  }

  function updateRespostasSortHeaders() {
    renderRespostasTableHead();
  }

  function setRespostasFilter(classificacao) {
    respostasFilterClassificacao = classificacao || '';
    updateRespostasFiltersUi();
    renderRespostasSub();
    renderRespostasTableBody();
  }

  function toggleRespostasSort(key) {
    if (!key) return;
    if (respostasSort.key === key) {
      respostasSort = { key, dir: respostasSort.dir === 'asc' ? 'desc' : 'asc' };
    } else {
      respostasSort = { key, dir: 'desc' };
    }
    writeRespostasSort(respostasCtx.formulario?.id, respostasSort);
    updateRespostasSortHeaders();
    renderRespostasTableBody();
  }

  function renderRespostasSub() {
    const total = respostasCtx.respostas?.length || 0;
    const visiveis = getRespostasVisiveis();
    const pendentes = (respostasCtx.respostas || []).filter((r) => r.classificacao === 'pendente').length;

    if (!els.respostasSub) return;

    if (!total) {
      els.respostasSub.textContent = 'Nenhuma resposta recebida ainda.';
      return;
    }

    const parts = [
      `${total} resposta${total === 1 ? '' : 's'} recebida${total === 1 ? '' : 's'}`,
    ];
    if (pendentes) {
      parts.push(`${pendentes} pendente${pendentes === 1 ? '' : 's'}`);
    }
    if (respostasFilterClassificacao) {
      const label = CLASSIFICACAO_LABELS[respostasFilterClassificacao] || respostasFilterClassificacao;
      parts.push(
        `exibindo ${visiveis.length} com classificação “${label}”`,
      );
    }
    els.respostasSub.textContent = parts.join(' · ');
  }

  function formatTelefoneDisplay(phone) {
    if (!phone) return '—';
    return formatPhoneDisplay(phone) || phone;
  }

  function renderRespostasTableBody() {
    if (!els.respostasTable) return;
    const campos = respostasCtx.formulario?.campos || [];
    const { fixas, listCols } = getRespostasListConfig(respostasCtx.formulario);
    const respostas = getRespostasVisiveis();
    const total = respostasCtx.respostas?.length || 0;
    const colspan = respostasTableColspan();

    renderRespostasTableHead();

    els.respostasTable.innerHTML = respostas.length
      ? respostas
          .map((r) => {
            const resumo = buildResumo(r, campos);
            const fixedCells = fixas.map((key) => renderRespostaFixedCell(key, r)).join('');
            const dynamicCells = listCols
              ? listCols
                  .map((campo) => {
                    const text = formatRespostaPlain(campo, r.respostas?.[campo.id]) || '—';
                    return `<td class="marketing-resposta-col-campo" title="${escapeHtml(text)}">${renderRespostaListCell(campo, r)}</td>`;
                  })
                  .join('')
              : `<td class="marketing-resposta-resumo" title="${escapeHtml(resumo)}">${escapeHtml(resumo)}</td>`;
            return `
              <tr class="marketing-resposta-row${r.classificacao === 'aprovado' ? ' marketing-resposta-row--aprovado' : r.classificacao === 'reprovado' ? ' marketing-resposta-row--reprovado' : ''}" data-id="${r.id}">
                ${fixedCells}
                ${dynamicCells}
                <td class="marketing-resposta-actions">
                  <button class="tbtn" type="button" data-action="open-resposta" data-id="${r.id}">Analisar</button>
                  <button class="tbtn marketing-resposta-delete" type="button" data-action="delete-resposta" data-id="${r.id}">Excluir</button>
                </td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="${colspan}" class="cell-empty">${
          total
            ? 'Nenhuma resposta corresponde ao filtro selecionado.'
            : 'Nenhuma resposta recebida ainda.'
        }</td></tr>`;
    bindRespostasTableActions();
  }

  function openRespostasColunasModal() {
    const formulario = respostasCtx.formulario;
    if (!formulario?.id) return;

    const campos = formulario.campos || [];
    respostasColunasDraft = colunasListaFromFormulario(formulario, campos);
    renderColunasListaEditor(els.respostasColunasListaWrap, respostasColunasDraft, campos);
    els.respostasColunasModalBg?.classList.add('open');
  }

  function closeRespostasColunasModal() {
    els.respostasColunasModalBg?.classList.remove('open');
    respostasColunasDraft = cloneColunasLista();
  }

  async function saveRespostasColunasModal() {
    const formulario = respostasCtx.formulario;
    if (!formulario?.id) return;

    const campos = formulario.campos || [];
    const nextColunas = readColunasListaFromContainer(els.respostasColunasListaWrap, campos);

    if (els.respostasColunasSave) {
      els.respostasColunasSave.disabled = true;
      els.respostasColunasSave.textContent = 'Salvando…';
    }

    try {
      const updated = await updateMarketingFormulario(formulario.id, { colunasLista: nextColunas });
      const colunasListaSaved = updated?.formulario?.colunasLista || nextColunas;
      respostasCtx = {
        ...respostasCtx,
        formulario: {
          ...formulario,
          colunasLista: colunasListaSaved,
        },
      };

      const idx = formularios.findIndex((f) => Number(f.id) === Number(formulario.id));
      if (idx >= 0) {
        formularios[idx] = { ...formularios[idx], colunasLista: colunasListaSaved };
      }

      closeRespostasColunasModal();
      renderRespostasTableBody();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar as colunas.');
    } finally {
      if (els.respostasColunasSave) {
        els.respostasColunasSave.disabled = false;
        els.respostasColunasSave.textContent = 'Salvar';
      }
    }
  }

  async function openRespostasPage(formularioId, { reload = false } = {}) {
    try {
      const data = await fetchFormularioRespostas(formularioId);
      respostasCtx = data;
      if (!reload) {
        respostasFilterClassificacao = '';
      }
      respostasSort = readRespostasSort(formularioId);

      if (els.respostasTitle) {
        els.respostasTitle.textContent = `Respostas · ${data.formulario.nome}`;
      }
      updateRespostasFiltersUi();
      renderRespostasSub();
      renderRespostasTableBody();

      if (!reload) setRespostasPageVisible(true);
    } catch (err) {
      alert(err.message || 'Não foi possível carregar respostas.');
    }
  }

  async function loadFormularios() {
    const res = await fetchMarketingFormularios();
    formularios = res.formularios || [];
    renderTable();
  }

  els.btnNew?.addEventListener('click', () => openFormModal());
  bindLogoInput();
  bindCorFundoInputs();
  bindIntroAi();
  bindSecoesAi();
  els.btnAddCampo?.addEventListener('click', () => {
    syncCampoFromDom();
    campos.push(defaultCampo(campos.length));
    colunasLista = normalizeColunasListaForCampos(colunasLista, campos);
    renderCamposBuilder();
  });
  els.btnAddSecao?.addEventListener('click', () => {
    syncSecoesFromDom();
    secoes.push(defaultSecao(secoes.length));
    renderSecoesBuilder();
  });
  els.btnAddSecaoAi?.addEventListener('click', () => {
    const nome = els.fieldNome?.value.trim() || '';
    if (!nome) {
      alert('Informe o nome do formulário antes de gerar o texto.');
      els.fieldNome?.focus();
      return;
    }
    syncSecoesFromDom();
    secoes.push(defaultSecao(secoes.length));
    renderSecoesBuilder();
    void generateSecaoWithAi(secoes.length - 1);
  });
  els.btnCancel?.addEventListener('click', closeFormModal);
  els.btnSave?.addEventListener('click', () => void saveFormModal());
  els.btnDelete?.addEventListener('click', () => {
    if (editId) deleteFormulario(editId).then(closeFormModal);
  });
  els.respostasBack?.addEventListener('click', closeRespostasPage);
  els.respostasColunasBtn?.addEventListener('click', () => openRespostasColunasModal());
  els.respostasColunasCancel?.addEventListener('click', closeRespostasColunasModal);
  els.respostasColunasSave?.addEventListener('click', () => void saveRespostasColunasModal());
  els.respostasColunasModalBg?.addEventListener('click', (event) => {
    if (event.target === els.respostasColunasModalBg) closeRespostasColunasModal();
  });
  els.respostasFilters?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-respostas-filter]');
    if (!btn || btn.disabled) return;
    setRespostasFilter(btn.dataset.respostasFilter || '');
  });
  els.respostasTableWrap?.addEventListener('click', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th) return;
    event.preventDefault();
    toggleRespostasSort(th.dataset.sort);
  });
  els.respostaDetailBack?.addEventListener('click', closeRespostaDetail);
  els.respostaDetailCancel?.addEventListener('click', closeRespostaDetail);
  els.respostaDetailDelete?.addEventListener('click', () => {
    if (respostaEditId) void deleteResposta(respostaEditId);
  });
  els.respostaParticipanteNome?.addEventListener('input', syncRespostaDetailTitle);
  els.respostaParticipanteInstagram?.addEventListener('input', syncRespostaInstagramOpenBtn);
  els.respostaParticipanteInstagramOpen?.addEventListener('click', (event) => {
    const url = instagramProfileUrl(els.respostaParticipanteInstagram?.value || '');
    if (!url) {
      event.preventDefault();
    }
  });
  els.respostaDetailSave?.addEventListener('click', () => void saveRespostaDetail());
  els.respostaInteracaoForm?.addEventListener('submit', (event) => void submitRespostaInteracao(event));
  els.respostaInteracoesList?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="delete-interacao"]');
    if (!btn) return;
    event.preventDefault();
    void deleteRespostaInteracao(Number(btn.dataset.id));
  });
  els.respostaTelefone?.addEventListener('input', () => maskPhoneInput(els.respostaTelefone));
  els.respostaDetailPage?.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-action="edit-marketing-telefone"]');
    if (editBtn) {
      event.preventDefault();
      event.stopPropagation();
      openTelefoneEditor();
      return;
    }

    const saveBtn = event.target.closest('[data-action="save-marketing-telefone"]');
    if (saveBtn) {
      event.preventDefault();
      event.stopPropagation();
      void confirmTelefoneEditor();
      return;
    }

    const cancelBtn = event.target.closest('[data-action="cancel-marketing-telefone"]');
    if (cancelBtn) {
      event.preventDefault();
      event.stopPropagation();
      cancelTelefoneEditor();
      return;
    }

    const btn = event.target.closest('[data-action="open-marketing-whatsapp"]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const resposta = getRespostaAtual();
    if (resposta) void handleOpenWhatsappFromResposta(resposta);
  });
  bindRespostasTableActions();

  return {
    showPanel(visible) {
      if (!visible) {
        closeRespostaDetail();
        closeRespostasPage();
      }
      els.panel?.classList.toggle('hidden', !visible || respostasPageOpen || respostaDetailOpen);
      if (visible && !respostasPageOpen && !respostaDetailOpen) void loadFormularios();
    },
    closeRespostasPage,
    loadFormularios,
    renderTable,
  };
}
