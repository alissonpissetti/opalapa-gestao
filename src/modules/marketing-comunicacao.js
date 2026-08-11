import {
  fetchMarketingComunicacaoVariaveis,
  fetchMarketingComunicacoes,
  fetchMarketingComunicacao,
  createMarketingComunicacao,
  updateMarketingComunicacao,
  deleteMarketingComunicacao,
  gerarPreviewMarketingComunicacao,
  updateMarketingComunicacaoItem,
  deleteMarketingComunicacaoItem,
  atualizarConteudoMarketingComunicacaoItem,
  pausarMarketingComunicacaoItem,
  limparPreviewMarketingComunicacao,
  iniciarEnvioMarketingComunicacao,
  pausarMarketingComunicacao,
  enviarMarketingComunicacaoItem,
} from '../lib/api.js';
import { escapeHtml, fmtMoney, fmtDate } from '../lib/format.js';

const DEFAULT_TEMPLATE = `Olá {{nome}}, tudo bem?

Passando para alinhar os detalhes da participação da {{empresa}} no Opalapa deste ano.

Conforme combinamos, a cota "{{cota}}" ficou no valor de {{valor_total}}. No momento, permanece em aberto o valor de {{valor_em_aberto}}.

Para nossa organização, esse valor pode ser regularizado até 20/10/2026, da forma que for mais conveniente para vocês. Caso prefiram, o pagamento pode ser realizado via PIX (CNPJ 27.469.306/0001-48).

Se precisarem de qualquer informação ou quiserem conversar sobre a parceria, é só nos chamar por aqui.

Obrigado mais uma vez pela confiança e por fazer parte de mais uma edição do Opalapa. Contamos com vocês para construir um evento ainda maior!

Um abraço,
Alisson de Almeida Pissetti
Equipe Opalapa
https://instagram.com/opalapa_oficial`;

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  preview: 'Prévia gerada',
  enviando: 'Enviando',
  pausado: 'Pausado',
  concluido: 'Concluído',
};

const ITEM_STATUS_LABELS = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  reenvio_pendente: 'Conteúdo atualizado',
  erro: 'Erro',
  ignorado: 'Ignorado',
};

export function initMarketingComunicacao({ onSummaryChange, onTabOpen } = {}) {
  const els = {
    panel: document.getElementById('marketing-panel-comunicacao'),
    listView: document.getElementById('marketing-com-list-view'),
    editorView: document.getElementById('marketing-com-editor-view'),
    listTable: document.getElementById('marketing-com-list-table'),
    btnNew: document.getElementById('btn-marketing-com-new'),
    btnOpen: document.getElementById('btn-marketing-com-open'),
    btnBack: document.getElementById('marketing-com-back'),
    editorTitle: document.getElementById('marketing-com-editor-title'),
    editorSub: document.getElementById('marketing-com-editor-sub'),
    fieldNome: document.getElementById('marketing-com-nome'),
    comFilters: document.getElementById('marketing-com-filters'),
    somenteSaldo: document.getElementById('marketing-com-somente-saldo'),
    comTemplate: document.getElementById('marketing-com-template'),
    comVarsHint: document.getElementById('marketing-com-vars-hint'),
    comIntervalMin: document.getElementById('marketing-com-interval-min'),
    comIntervalMax: document.getElementById('marketing-com-interval-max'),
    btnSave: document.getElementById('btn-marketing-com-save'),
    btnPreview: document.getElementById('btn-marketing-com-preview'),
    btnClear: document.getElementById('btn-marketing-com-clear'),
    comPreview: document.getElementById('marketing-com-preview'),
    comMeta: document.getElementById('marketing-com-meta'),
    comTable: document.getElementById('marketing-com-table'),
    btnStart: document.getElementById('btn-marketing-com-start'),
    btnPause: document.getElementById('btn-marketing-com-pause'),
    comProgress: document.getElementById('marketing-com-progress'),
    comErrors: document.getElementById('marketing-com-errors'),
  };

  let comunicacoes = [];
  let editId = null;
  let current = null;
  let itens = [];
  let templateVars = [];
  let comDispatching = false;
  let comPaused = false;
  let comAbort = false;
  let sendingItemId = null;
  let updatingItemId = null;

  function showPanel(visible) {
    els.panel?.classList.toggle('hidden', !visible);
  }

  function setListView() {
    els.listView?.classList.remove('hidden');
    els.editorView?.classList.add('hidden');
    editId = null;
    current = null;
    itens = [];
  }

  function setEditorView() {
    els.listView?.classList.add('hidden');
    els.editorView?.classList.remove('hidden');
  }

  function getSelectedComTipos() {
    if (!els.comFilters) return [];
    return [...els.comFilters.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
  }

  function getComIntervalBounds() {
    let min = Number(els.comIntervalMin?.value) || 15;
    let max = Number(els.comIntervalMax?.value) || 45;
    min = Math.min(Math.max(min, 5), 600);
    max = Math.min(Math.max(max, 5), 600);
    if (min > max) [min, max] = [max, min];
    return { min, max };
  }

  function readEditorPayload() {
    return {
      nome: els.fieldNome?.value.trim() || 'Nova comunicação',
      template: els.comTemplate?.value || '',
      tipos: getSelectedComTipos(),
      filtros: { somenteComSaldo: els.somenteSaldo?.checked !== false },
      intervaloMin: getComIntervalBounds().min,
      intervaloMax: getComIntervalBounds().max,
    };
  }

  function renderVarsHint() {
    if (!els.comVarsHint) return;
    const keys = templateVars.length
      ? templateVars.map((v) => `{{${v.key}}}`).join(', ')
      : '{{nome}}, {{empresa}}, {{espaco}}, {{cota}}, {{valor_total}}, {{valor_em_aberto}}…';
    els.comVarsHint.textContent = `Variáveis: ${keys}`;
  }

  async function loadVars() {
    try {
      const data = await fetchMarketingComunicacaoVariaveis();
      templateVars = data.variaveis || [];
      renderVarsHint();
    } catch {
      renderVarsHint();
    }
  }

  function renderListTable() {
    if (!els.listTable) return;
    els.listTable.innerHTML = comunicacoes.length
      ? comunicacoes
          .map(
            (c) => `
        <tr>
          <td><strong>${escapeHtml(c.nome)}</strong></td>
          <td><span class="marketing-com-status marketing-com-status--${c.status}">${STATUS_LABELS[c.status] || c.status}</span></td>
          <td>${c.itensAtivos ?? c.totalDestinatarios ?? 0}</td>
          <td>${c.itensEnviados ?? c.totalEnviados ?? 0}</td>
          <td>${c.updatedAt ? escapeHtml(fmtDate(c.updatedAt)) : '—'}</td>
          <td class="row-actions">
            <button class="tbtn" type="button" data-action="open-com" data-id="${c.id}">Abrir</button>
            <button class="tbtn danger-text" type="button" data-action="delete-com" data-id="${c.id}">Excluir</button>
          </td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="cell-empty">Nenhuma comunicação salva. Crie uma nova para começar.</td></tr>';

    els.listTable.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.action === 'open-com') void openComunicacao(id);
        if (btn.dataset.action === 'delete-com') void removeComunicacao(id);
      });
    });
  }

  async function loadList() {
    const data = await fetchMarketingComunicacoes();
    comunicacoes = data.comunicacoes || [];
    renderListTable();
    onSummaryChange?.(`${comunicacoes.length} comunicação(ões) salva(s)`);
  }

  function fillEditor(com) {
    if (els.fieldNome) els.fieldNome.value = com?.nome || '';
    if (els.comTemplate) els.comTemplate.value = com?.template || DEFAULT_TEMPLATE;
    if (els.comIntervalMin) els.comIntervalMin.value = String(com?.intervaloMin ?? 15);
    if (els.comIntervalMax) els.comIntervalMax.value = String(com?.intervaloMax ?? 45);
    if (els.somenteSaldo) {
      els.somenteSaldo.checked = com?.filtros?.somenteComSaldo !== false;
    }
    const tipos = new Set(com?.tipos || ['espaco', 'patrocinio']);
    els.comFilters?.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = tipos.has(input.value);
    });
    if (els.editorTitle) {
      els.editorTitle.textContent = com?.id ? com.nome : 'Nova comunicação';
    }
    if (els.editorSub) {
      els.editorSub.textContent = com?.id
        ? `Status: ${STATUS_LABELS[com.status] || com.status}`
        : 'Salve o rascunho e gere a prévia antes de disparar.';
    }
  }

  function isAutoDispatchable(item) {
    return (
      item.incluido &&
      !item.pausado &&
      (item.status === 'pendente' || item.status === 'erro' || item.status === 'reenvio_pendente')
    );
  }

  function canStartDispatch() {
    return current && itens.some((i) => isAutoDispatchable(i));
  }

  function updateDispatchUi() {
    const pending = itens.filter((i) => isAutoDispatchable(i));
    const paused = itens.filter(
      (i) =>
        i.incluido &&
        i.pausado &&
        (i.status === 'pendente' || i.status === 'erro' || i.status === 'reenvio_pendente'),
    );
    const total = itens.filter((i) => i.incluido).length;
    const sent = itens.filter((i) => i.status === 'enviado').length;

    if (els.comProgress) {
      const pausedHint = paused.length ? ` · ${paused.length} pausado(s)` : '';
      els.comProgress.textContent = total
        ? `${sent} de ${total} enviado(s)${pausedHint}${comPaused ? ' · disparo pausado' : comDispatching ? ' · enviando…' : ''}`
        : '';
    }
    if (els.btnStart) {
      els.btnStart.disabled = !canStartDispatch() || comDispatching;
      els.btnStart.textContent =
        sent > 0 && sent < total ? 'Retomar disparo' : 'Iniciar disparo';
      els.btnStart.classList.toggle('hidden', comDispatching && !comPaused);
    }
    els.btnPause?.classList.toggle('hidden', !comDispatching || comPaused);
  }

  function formatItemStatus(item, sendingThis, updatingThis = false) {
    if (sendingThis) return 'Enviando…';
    if (updatingThis) return 'Atualizando conteúdo…';
    if (item.pausado && item.status !== 'enviado') {
      const base =
        item.status === 'reenvio_pendente'
          ? 'Conteúdo atualizado'
          : ITEM_STATUS_LABELS[item.status] || item.status;
      return `${base} · comunicação pausada`;
    }
    if (item.status === 'reenvio_pendente') {
      return item.enviadoEm
        ? `Conteúdo atualizado · último envio ${fmtDate(item.enviadoEm)}`
        : ITEM_STATUS_LABELS.reenvio_pendente;
    }
    if (item.status === 'enviado') {
      return item.enviadoEm
        ? `Enviado · ${fmtDate(item.enviadoEm)}`
        : ITEM_STATUS_LABELS.enviado;
    }
    if (item.status === 'erro' && item.erroMsg) {
      return `Erro · ${item.erroMsg}`;
    }
    return ITEM_STATUS_LABELS[item.status] || item.status;
  }

  function applySentItemResult(itemId, data) {
    if (data?.item) {
      const idx = itens.findIndex((i) => i.id === itemId);
      if (idx >= 0) itens[idx] = data.item;
      return;
    }
    const idx = itens.findIndex((i) => i.id === itemId);
    if (idx >= 0 && data?.enviadoEm) {
      itens[idx] = {
        ...itens[idx],
        status: 'enviado',
        enviadoEm: data.enviadoEm,
        mensagem: getMensagemFromRow(itemId) || itens[idx].mensagem,
      };
    }
  }

  function destinatarioLines(item) {
    let empresa = String(item.nome || '').trim();
    let contato = String(item.contatoNome || '').trim();
    if (!contato && empresa.includes(' · ')) {
      const sep = empresa.indexOf(' · ');
      contato = empresa.slice(sep + 3).trim();
      empresa = empresa.slice(0, sep).trim();
    }
    return {
      empresa: empresa || '—',
      contato,
      telefone: String(item.telefone || '').trim(),
    };
  }

  function renderPreviewTable() {
    if (!els.comTable) return;
    const rows = itens.filter((i) => i.incluido);
    els.comTable.innerHTML = rows.length
      ? rows
          .map((item) => {
            const sendingThis = sendingItemId === item.id;
            const updatingThis = updatingItemId === item.id;
            const rowLocked = comDispatching || sendingThis || updatingThis;
            const isResend = item.status === 'enviado' || item.status === 'reenvio_pendente';
            const valor =
              item.valorEmAberto != null ? fmtMoney(item.valorEmAberto) : '—';
            const canSend =
              !comDispatching &&
              !sendingItemId &&
              !updatingItemId &&
              (item.status === 'pendente' ||
                item.status === 'erro' ||
                item.status === 'enviado' ||
                item.status === 'reenvio_pendente');
            const canRemove =
              !comDispatching &&
              !sendingItemId &&
              !updatingItemId &&
              item.status !== 'enviado' &&
              item.status !== 'reenvio_pendente';
            const canUpdateContent =
              !comDispatching &&
              !sendingItemId &&
              !updatingItemId &&
              (item.status === 'enviado' || item.status === 'reenvio_pendente');
            const canPauseComunicacao =
              !comDispatching &&
              !sendingItemId &&
              !updatingItemId &&
              item.status !== 'enviado' &&
              (item.status === 'pendente' || item.status === 'erro' || item.status === 'reenvio_pendente');
            const pauseLabel = item.pausado ? 'Retomar comunicação' : 'Pausar comunicação';
            const sendLabel = isResend ? 'Reenviar' : 'Enviar';
            const sendBtnClass =
              item.status === 'reenvio_pendente'
                ? 'tbtn primary marketing-com-send-btn marketing-com-send-btn--resend'
                : 'tbtn primary marketing-com-send-btn';
            const dest = destinatarioLines(item);
            return `
        <tr data-item-id="${item.id}" class="marketing-com-item-row marketing-com-item-row--${item.status}${item.pausado ? ' marketing-com-item-row--paused' : ''}">
          <td class="marketing-com-dest-cell">
            <div class="marketing-com-dest-empresa">${escapeHtml(dest.empresa)}</div>
            ${dest.contato ? `<div class="marketing-com-dest-contato">${escapeHtml(dest.contato)}</div>` : ''}
            ${dest.telefone ? `<div class="marketing-com-dest-tel">${escapeHtml(dest.telefone)}</div>` : ''}
          </td>
          <td class="marketing-com-info-cell">
            <div class="marketing-com-info-tipo">${escapeHtml(item.tipoLabel || item.tipo)}</div>
            <div class="marketing-com-info-valor">${escapeHtml(valor)}</div>
          </td>
          <td class="marketing-com-msg-cell">
            <textarea class="marketing-com-item-msg" data-field="mensagem" rows="5"${rowLocked ? ' readonly' : ''}>${escapeHtml(item.mensagem)}</textarea>
          </td>
          <td class="marketing-com-status-cell">${escapeHtml(formatItemStatus(item, sendingThis, updatingThis))}</td>
          <td class="marketing-com-row-actions">
            <div class="marketing-com-row-actions-inner">
              ${canPauseComunicacao ? `<button class="tbtn marketing-com-pause-item-btn" type="button" data-action="pause-item" data-id="${item.id}" data-pausado="${item.pausado ? '1' : '0'}">${pauseLabel}</button>` : ''}
              ${canSend && item.status === 'reenvio_pendente' ? `<button class="${sendBtnClass}" type="button" data-action="send-item" data-id="${item.id}" data-resend="1">${sendLabel}</button>` : ''}
              ${canUpdateContent ? `<button class="tbtn marketing-com-update-btn" type="button" data-action="update-content" data-id="${item.id}">Atualizar conteúdo</button>` : ''}
              ${canSend && item.status !== 'reenvio_pendente' ? `<button class="${sendBtnClass}" type="button" data-action="send-item" data-id="${item.id}" data-resend="${isResend ? '1' : '0'}">${sendLabel}</button>` : ''}
              ${canRemove ? `<button class="tbtn danger-text marketing-com-remove-btn" type="button" data-action="remove-item" data-id="${item.id}">Remover</button>` : ''}
            </div>
          </td>
        </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="cell-empty">Nenhum destinatário na prévia. Ajuste filtros ou clique em Gerar prévia.</td></tr>';

    els.comTable.querySelectorAll('textarea[data-field="mensagem"]').forEach((ta) => {
      ta.addEventListener('change', () => void saveItemFromRow(ta.closest('tr')));
    });
    els.comTable.querySelectorAll('[data-action="remove-item"]').forEach((btn) => {
      btn.addEventListener('click', () => void removeItem(Number(btn.dataset.id)));
    });
    els.comTable.querySelectorAll('[data-action="update-content"]').forEach((btn) => {
      btn.addEventListener('click', () => void atualizarConteudoItem(Number(btn.dataset.id)));
    });
    els.comTable.querySelectorAll('[data-action="pause-item"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        void togglePauseComunicacaoItem(Number(btn.dataset.id), btn.dataset.pausado !== '1'),
      );
    });
    els.comTable.querySelectorAll('[data-action="send-item"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        void sendSingleItem(Number(btn.dataset.id), btn.dataset.resend === '1'),
      );
    });

    updateDispatchUi();
  }

  function getMensagemFromRow(itemId) {
    const row = els.comTable?.querySelector(`tr[data-item-id="${itemId}"]`);
    const fromRow = row?.querySelector('[data-field="mensagem"]')?.value?.trim();
    if (fromRow) return fromRow;
    return itens.find((i) => i.id === itemId)?.mensagem?.trim() || '';
  }

  async function sendSingleItem(itemId, isResend = false) {
    if (!editId || comDispatching || sendingItemId) return;
    const item = itens.find((i) => i.id === itemId);
    if (!item) return;
    if (!isResend && (item.status === 'enviado' || item.status === 'reenvio_pendente')) return;

    const mensagem = getMensagemFromRow(itemId);
    if (!mensagem) {
      alert('Informe o texto da mensagem.');
      return;
    }

    const confirmMsg = isResend
      ? `Reenviar esta mensagem para ${item.nome}?\n\nUm novo WhatsApp será disparado agora.`
      : `Enviar esta mensagem para ${item.nome}?\n\nO WhatsApp será disparado agora.`;
    if (!confirm(confirmMsg)) return;

    sendingItemId = itemId;
    renderPreviewTable();
    try {
      const data = await enviarMarketingComunicacaoItem({
        arrecadacaoId: item.arrecadacaoId,
        texto: mensagem,
        itemId: item.id,
        comunicacaoId: editId,
      });
      applySentItemResult(itemId, data);
      const refreshed = await fetchMarketingComunicacao(editId);
      current = refreshed.comunicacao;
      itens = refreshed.itens || itens;
      fillEditor(current);
      renderPreviewState();
      await loadList();
    } catch (err) {
      appendComError(`${item.nome}: ${err.message || 'falha no envio'}`);
      const refreshed = await fetchMarketingComunicacao(editId);
      current = refreshed.comunicacao;
      itens = refreshed.itens || [];
      renderPreviewState();
    } finally {
      sendingItemId = null;
      renderPreviewTable();
    }
  }

  async function togglePauseComunicacaoItem(itemId, pausar) {
    if (!editId || comDispatching || sendingItemId || updatingItemId) return;
    try {
      const { item } = await pausarMarketingComunicacaoItem(editId, itemId, pausar);
      const idx = itens.findIndex((i) => i.id === itemId);
      if (idx >= 0) itens[idx] = item;
      const refreshed = await fetchMarketingComunicacao(editId);
      current = refreshed.comunicacao;
      itens = refreshed.itens || itens;
      fillEditor(current);
      renderPreviewState();
    } catch (err) {
      alert(err.message || 'Não foi possível atualizar a pausa desta comunicação.');
    }
  }

  async function atualizarConteudoItem(itemId) {
    if (!editId || comDispatching || sendingItemId || updatingItemId) return;
    const item = itens.find((i) => i.id === itemId);
    if (!item || (item.status !== 'enviado' && item.status !== 'reenvio_pendente')) return;

    const payload = readEditorPayload();
    if (!payload.template.trim()) {
      alert('Informe o template da mensagem antes de atualizar o conteúdo.');
      return;
    }

    updatingItemId = itemId;
    renderPreviewTable();
    try {
      await updateMarketingComunicacao(editId, payload);
      const { item: updated } = await atualizarConteudoMarketingComunicacaoItem(editId, itemId);
      const idx = itens.findIndex((i) => i.id === itemId);
      if (idx >= 0) itens[idx] = updated;
      const refreshed = await fetchMarketingComunicacao(editId);
      current = refreshed.comunicacao;
      itens = refreshed.itens || itens;
      fillEditor(current);
      renderPreviewState();
      if (
        itens.find((i) => i.id === itemId)?.status === 'reenvio_pendente' &&
        confirm('Conteúdo atualizado com o template atual.\n\nDeseja reenviar esta mensagem agora?')
      ) {
        await sendSingleItem(itemId, true);
      }
    } catch (err) {
      alert(err.message || 'Não foi possível atualizar o conteúdo.');
    } finally {
      updatingItemId = null;
      renderPreviewTable();
    }
  }

  async function saveItemFromRow(row) {
    if (!row || !editId) return;
    const itemId = Number(row.dataset.itemId);
    const mensagem = row.querySelector('[data-field="mensagem"]')?.value?.trim() || '';
    try {
      const { item } = await updateMarketingComunicacaoItem(editId, itemId, { mensagem, incluido: true });
      const idx = itens.findIndex((i) => i.id === itemId);
      if (idx >= 0) itens[idx] = item;
      renderPreviewTable();
    } catch (err) {
      alert(err.message || 'Não foi possível salvar a mensagem.');
    }
  }

  async function removeItem(itemId) {
    if (!editId || comDispatching) return;
    if (!confirm('Remover este destinatário da lista?')) return;
    try {
      const data = await deleteMarketingComunicacaoItem(editId, itemId);
      current = data.comunicacao;
      itens = data.itens || [];
      fillEditor(current);
      renderPreviewState();
      await loadList();
    } catch (err) {
      alert(err.message || 'Não foi possível remover o destinatário.');
    }
  }

  async function clearPreviewList() {
    if (!editId || comDispatching) return;
    if (!itens.length) {
      alert('A lista já está vazia.');
      return;
    }
    if (
      !confirm(
        'Limpar toda a prévia? Os destinatários serão removidos e você poderá gerar uma nova lista com os filtros atuais.',
      )
    ) {
      return;
    }
    try {
      const data = await limparPreviewMarketingComunicacao(editId);
      current = data.comunicacao;
      itens = data.itens || [];
      fillEditor(current);
      renderPreviewState();
      await loadList();
    } catch (err) {
      alert(err.message || 'Não foi possível limpar a lista.');
    }
  }

  function renderPreviewState() {
    const ativos = itens.filter((i) => i.incluido);
    const hasPreview = ativos.length > 0;
    els.comPreview?.classList.toggle('hidden', !hasPreview);
    if (els.btnClear) {
      els.btnClear.disabled = comDispatching || sendingItemId || !itens.length;
    }
    if (els.comMeta) {
      els.comMeta.textContent = hasPreview
        ? `${ativos.length} destinatário(s) · use Pausar comunicação para ignorar linhas no disparo automático`
        : '';
    }
    renderPreviewTable();
  }

  async function openComunicacao(id) {
    const data = await fetchMarketingComunicacao(id);
    current = data.comunicacao;
    editId = current.id;
    itens = data.itens || [];
    fillEditor(current);
    renderPreviewState();
    setEditorView();
    resetDispatchState();
  }

  function openNewComunicacao() {
    editId = null;
    current = null;
    itens = [];
    fillEditor(null);
    if (els.comPreview) els.comPreview.classList.add('hidden');
    if (els.comErrors) {
      els.comErrors.innerHTML = '';
      els.comErrors.classList.add('hidden');
    }
    setEditorView();
    resetDispatchState();
  }

  function resetDispatchState() {
    comDispatching = false;
    comPaused = false;
    comAbort = false;
    updateDispatchUi();
  }

  async function saveComunicacao() {
    const payload = readEditorPayload();
    if (!payload.tipos.length) {
      alert('Selecione ao menos um tipo de lead.');
      return;
    }

    els.btnSave.disabled = true;
    try {
      if (editId) {
        const data = await updateMarketingComunicacao(editId, payload);
        current = data.comunicacao;
        itens = data.itens || [];
      } else {
        const data = await createMarketingComunicacao(payload);
        current = data.comunicacao;
        editId = current.id;
        itens = data.itens || [];
      }
      fillEditor(current);
      renderPreviewState();
      await loadList();
      alert('Rascunho salvo.');
    } catch (err) {
      alert(err.message || 'Não foi possível salvar.');
    } finally {
      els.btnSave.disabled = false;
    }
  }

  async function generatePreview() {
    if (!editId) {
      await saveComunicacao();
      if (!editId) return;
    }

    const payload = readEditorPayload();
    if (!payload.template.trim()) {
      alert('Informe o template da mensagem.');
      return;
    }

    await updateMarketingComunicacao(editId, payload);
    els.btnPreview.disabled = true;
    const prev = els.btnPreview.textContent;
    els.btnPreview.textContent = 'Gerando prévia…';
    resetDispatchState();
    if (els.comErrors) {
      els.comErrors.innerHTML = '';
      els.comErrors.classList.add('hidden');
    }

    try {
      const data = await gerarPreviewMarketingComunicacao(editId);
      current = data.comunicacao;
      itens = data.itens || [];
      fillEditor(current);
      els.comPreview?.classList.remove('hidden');
      renderPreviewState();
      await loadList();
    } catch (err) {
      alert(err.message || 'Não foi possível gerar a prévia.');
    } finally {
      els.btnPreview.disabled = false;
      els.btnPreview.textContent = prev;
    }
  }

  function appendComError(msg) {
    if (!els.comErrors) return;
    els.comErrors.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = msg;
    els.comErrors.appendChild(li);
  }

  function randomDelayMs(minSec, maxSec) {
    const sec = minSec + Math.random() * (maxSec - minSec);
    return Math.round(sec * 1000);
  }

  async function runDispatch() {
    if (!editId || !canStartDispatch()) {
      alert('Gere a prévia antes de iniciar o disparo.');
      return;
    }

    const pending = itens.filter((i) => isAutoDispatchable(i));
    if (!pending.length) {
      alert('Não há destinatários pendentes para o disparo automático.');
      return;
    }

    const pausedCount = itens.filter(
      (i) =>
        i.incluido &&
        i.pausado &&
        (i.status === 'pendente' || i.status === 'erro' || i.status === 'reenvio_pendente'),
    ).length;
    const confirmMsg = pausedCount
      ? `Enviar WhatsApp para ${pending.length} contato(s)?\n\n${pausedCount} destinatário(s) pausado(s) serão ignorados no disparo automático.`
      : `Enviar WhatsApp para ${pending.length} contato(s)?\n\nVocê já revisou a prévia de cada mensagem?`;
    if (!confirm(confirmMsg)) return;

    try {
      const data = await iniciarEnvioMarketingComunicacao(editId);
      current = data.comunicacao;
    } catch (err) {
      alert(err.message || 'Não foi possível iniciar o envio.');
      return;
    }

    comDispatching = true;
    comPaused = false;
    comAbort = false;
    updateDispatchUi();

    const { min, max } = getComIntervalBounds();

    for (const item of [...pending]) {
      if (comAbort || comPaused) break;
      if (item.pausado) continue;
      const mensagem = getMensagemFromRow(item.id) || item.mensagem;
      try {
        const data = await enviarMarketingComunicacaoItem({
          arrecadacaoId: item.arrecadacaoId,
          texto: mensagem,
          itemId: item.id,
          comunicacaoId: editId,
        });
        applySentItemResult(item.id, data);
      } catch (err) {
        item.status = 'erro';
        item.erroMsg = err.message || 'falha no envio';
        appendComError(`${item.nome}: ${err.message || 'falha no envio'}`);
      }
      renderPreviewTable();
      if (comAbort || comPaused) break;
      await new Promise((resolve) => setTimeout(resolve, randomDelayMs(min, max)));
    }

    comDispatching = false;
    updateDispatchUi();
    try {
      await pausarMarketingComunicacao(editId);
    } catch {
      /* normaliza status no servidor */
    }
    await loadList();
    const refreshed = await fetchMarketingComunicacao(editId);
    current = refreshed.comunicacao;
    itens = refreshed.itens || [];
    fillEditor(current);
    renderPreviewState();
  }

  async function pauseDispatch() {
    if (!editId) return;
    comPaused = true;
    comAbort = true;
    comDispatching = false;
    try {
      const data = await pausarMarketingComunicacao(editId);
      current = data.comunicacao;
      fillEditor(current);
    } catch (err) {
      alert(err.message || 'Não foi possível pausar.');
    }
    updateDispatchUi();
  }

  async function removeComunicacao(id) {
    if (!confirm('Excluir esta comunicação?')) return;
    try {
      await deleteMarketingComunicacao(id);
      if (editId === id) {
        setListView();
        editId = null;
        current = null;
      }
      await loadList();
    } catch (err) {
      alert(err.message || 'Não foi possível excluir.');
    }
  }

  async function onTabActivated() {
    setListView();
    await loadList();
  }

  els.btnNew?.addEventListener('click', () => openNewComunicacao());
  els.btnOpen?.addEventListener('click', () => onTabOpen?.('comunicacao'));
  els.btnBack?.addEventListener('click', () => {
    setListView();
    void loadList();
  });
  els.btnSave?.addEventListener('click', () => void saveComunicacao());
  els.btnPreview?.addEventListener('click', () => void generatePreview());
  els.btnClear?.addEventListener('click', () => void clearPreviewList());
  els.btnStart?.addEventListener('click', () => void runDispatch());
  els.btnPause?.addEventListener('click', () => void pauseDispatch());

  void loadVars();
  if (els.comTemplate && !els.comTemplate.value.trim()) {
    els.comTemplate.value = DEFAULT_TEMPLATE;
  }

  return {
    showPanel,
    onTabActivated,
    openNewComunicacao,
  };
}
