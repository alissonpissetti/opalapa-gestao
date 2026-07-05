import {
  fetchMarketingFormularios,
  createMarketingFormulario,
  updateMarketingFormulario,
  deleteMarketingFormulario,
  fetchFormularioRespostas,
  updateFormularioResposta,
  fetchMarketingFormularioLogoBlob,
  generateMarketingFormularioIntro,
} from '../lib/api.js';
import { escapeHtml, fmtMoney } from '../lib/format.js';
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

export function initMarketingFormularios({ getMarketingData, onSummaryChange }) {
  const els = {
    panel: document.getElementById('marketing-panel-formularios'),
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
    btnAddCampo: document.getElementById('marketing-form-add-campo'),
    btnCancel: document.getElementById('marketing-form-cancel'),
    btnSave: document.getElementById('marketing-form-save'),
    btnDelete: document.getElementById('marketing-form-delete'),
    linkPreview: document.getElementById('marketing-form-link'),
    respostasBg: document.getElementById('marketing-respostas-modal-bg'),
    respostasTitle: document.getElementById('marketing-respostas-title'),
    respostasTable: document.getElementById('marketing-respostas-table'),
    respostasClose: document.getElementById('marketing-respostas-close'),
    respostaDetailBg: document.getElementById('marketing-resposta-detail-bg'),
    respostaDetailTitle: document.getElementById('marketing-resposta-detail-title'),
    respostaDetailBody: document.getElementById('marketing-resposta-detail-body'),
    respostaClassificacao: document.getElementById('marketing-resposta-classificacao'),
    respostaNota: document.getElementById('marketing-resposta-nota'),
    respostaDetailCancel: document.getElementById('marketing-resposta-detail-cancel'),
    respostaDetailSave: document.getElementById('marketing-resposta-detail-save'),
  };

  let formularios = [];
  let editId = null;
  let campos = [];
  let respostasCtx = { formulario: null, respostas: [] };
  let respostaEditId = null;
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
            <strong>Pergunta ${index + 1}</strong>
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
        campos.splice(Number(btn.dataset.index), 1);
        renderCamposBuilder();
      });
    });

    els.camposList.querySelectorAll('[data-campo]').forEach((el) => {
      el.addEventListener('input', () => syncCampoFromDom());
      el.addEventListener('change', () => syncCampoFromDom());
    });
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
      descricaoLead: els.fieldDescricaoLead?.value.trim() || nome,
      tipoLead: els.fieldTipoLead?.value || 'patrocinio',
      statusInicial: els.fieldStatusInicial?.value || 'lead',
      ativo: els.fieldAtivo?.checked !== false,
      marketingCanalId: els.fieldCanal?.value || null,
      marketingCampanhaId: els.fieldCampanha?.value || null,
      marketingCriativoId: els.fieldCriativo?.value || null,
      campos: readCamposFromDom().filter((c) => c.label),
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
      btn.addEventListener('click', () => void openRespostasModal(Number(btn.dataset.id)));
    });
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

  function renderRespostaValue(campo, value) {
    if (value == null || value === '') return '—';
    if (campo?.type === 'checkbox') return value ? 'Sim' : 'Não';
    if (campo?.type === 'money') return escapeHtml(fmtMoney(value));
    return escapeHtml(String(value));
  }

  function openRespostaDetail(resposta) {
    respostaEditId = resposta.id;
    const form = respostasCtx.formulario;
    if (els.respostaDetailTitle) {
      els.respostaDetailTitle.textContent = resposta.participanteNome || 'Resposta';
    }
    if (els.respostaClassificacao) {
      els.respostaClassificacao.value = resposta.classificacao || 'pendente';
    }
    if (els.respostaNota) {
      els.respostaNota.value = resposta.notaInterna || '';
    }

    const camposById = new Map((form.campos || []).map((c) => [c.id, c]));
    const rows = (form.campos || []).map((campo) => {
      const value = resposta.respostas?.[campo.id];
      return `<tr><th>${escapeHtml(campo.label)}</th><td>${renderRespostaValue(campo, value)}</td></tr>`;
    });

    const fixedRows = `
      <tr><th>Nome</th><td>${escapeHtml(resposta.participanteNome || '—')}</td></tr>
      <tr><th>Telefone</th><td>${escapeHtml(resposta.participanteTelefone || '—')}</td></tr>
      <tr><th>Instagram</th><td>${escapeHtml(resposta.participanteInstagram || '—')}</td></tr>
    `;

    if (els.respostaDetailBody) {
      els.respostaDetailBody.innerHTML = `
        <table class="marketing-resposta-detail-table">
          <tbody>${fixedRows}${rows.join('')}</tbody>
        </table>`;
    }

    els.respostaDetailBg?.classList.add('open');
  }

  function closeRespostaDetail() {
    els.respostaDetailBg?.classList.remove('open');
    respostaEditId = null;
  }

  async function saveRespostaDetail() {
    if (!respostaEditId) return;
    els.respostaDetailSave.disabled = true;
    try {
      await updateFormularioResposta(respostaEditId, {
        classificacao: els.respostaClassificacao?.value,
        notaInterna: els.respostaNota?.value.trim(),
        atualizarLead: true,
        statusLead: els.respostaClassificacao?.value === 'reprovado' ? 'perda' : undefined,
      });
      closeRespostaDetail();
      if (respostasCtx.formulario?.id) {
        await openRespostasModal(respostasCtx.formulario.id, { keepOpen: true });
      }
      await loadFormularios();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      els.respostaDetailSave.disabled = false;
    }
  }

  async function openRespostasModal(formularioId, { keepOpen = false } = {}) {
    try {
      const data = await fetchFormularioRespostas(formularioId);
      respostasCtx = data;
      if (els.respostasTitle) {
        els.respostasTitle.textContent = `Respostas · ${data.formulario.nome}`;
      }
      if (els.respostasTable) {
        const campos = data.formulario.campos || [];
        const extraHeaders = campos.slice(0, 2).map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
        els.respostasTable.innerHTML = data.respostas.length
          ? data.respostas
              .map((r) => {
                const extras = campos
                  .slice(0, 2)
                  .map((c) => `<td>${renderRespostaValue(c, r.respostas?.[c.id])}</td>`)
                  .join('');
                return `
              <tr>
                <td><strong>${escapeHtml(r.participanteNome)}</strong></td>
                <td>${escapeHtml(r.participanteTelefone || '—')}</td>
                ${extras}
                <td><span class="marketing-classif marketing-classif--${r.classificacao}">${CLASSIFICACAO_LABELS[r.classificacao] || r.classificacao}</span></td>
                <td>${r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : '—'}</td>
                <td><button class="tbtn" type="button" data-action="open-resposta" data-id="${r.id}">Analisar</button></td>
              </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" class="cell-empty">Nenhuma resposta recebida ainda.</td></tr>';
      }

      els.respostasTable?.querySelectorAll('[data-action="open-resposta"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const resposta = respostasCtx.respostas.find((r) => r.id === Number(btn.dataset.id));
          if (resposta) openRespostaDetail(resposta);
        });
      });

      if (!keepOpen) els.respostasBg?.classList.add('open');
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
  els.btnAddCampo?.addEventListener('click', () => {
    campos.push(defaultCampo(campos.length));
    renderCamposBuilder();
  });
  els.btnCancel?.addEventListener('click', closeFormModal);
  els.btnSave?.addEventListener('click', () => void saveFormModal());
  els.btnDelete?.addEventListener('click', () => {
    if (editId) deleteFormulario(editId).then(closeFormModal);
  });
  els.respostasClose?.addEventListener('click', () => els.respostasBg?.classList.remove('open'));
  els.respostaDetailCancel?.addEventListener('click', closeRespostaDetail);
  els.respostaDetailSave?.addEventListener('click', () => void saveRespostaDetail());

  return {
    showPanel(visible) {
      els.panel?.classList.toggle('hidden', !visible);
      if (visible) void loadFormularios();
    },
    loadFormularios,
    renderTable,
  };
}
