import {
  fetchWhatsappInbox,
  fetchWhatsappInboxThread,
  fetchWhatsappThreadMessages,
  syncWhatsappInboxThread,
  sendWhatsappInboxMessage,
  sendWhatsappInboxReaction,
} from '../lib/api.js';
import { fmtDate, formatPhoneDisplay, escapeHtml } from '../lib/format.js';
import { wrapWhatsappBubble, renderWhatsappReactions } from '../lib/whatsapp-reactions.js';
import { bindWhatsappReactionControls } from '../lib/whatsapp-reactions-ui.js';
import { renderWhatsappMediaHtml, hydrateWhatsappMedia, retryPendingWhatsappMedia, patchWhatsappMessageMedia, stableMediaRef, shouldShowWhatsappBubbleText } from '../lib/whatsapp-media.js';
import { renderWhatsappBubbleTextHtml, bubbleModifierClasses } from '../lib/whatsapp-bubble-text.js';
import { initWhatsappCompose } from '../lib/whatsapp-compose.js';
import { readWhatsappDraft, writeWhatsappDraft, clearWhatsappDraft } from '../lib/whatsapp-drafts.js';
import { onEventoChange } from '../lib/evento.js';
import {
  bindContactAvatarImages,
  mountContactAvatar,
  participantInitial,
  avatarImgSrc,
} from '../lib/contact-avatar.js';

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = import.meta.env.VITE_API_URL || '';
  if (base) {
    try {
      const u = new URL(base);
      return `${proto}//${u.host}/ws/whatsapp`;
    } catch {
      /* fall through */
    }
  }
  return `${proto}//${location.host}/ws/whatsapp`;
}

function renderContactAvatar(contact, className = 'wa-thread-avatar') {
  const initial = participantInitial(contact?.participanteNome);
  const participanteId = Number(contact?.participanteId);
  const idAttr =
    Number.isInteger(participanteId) && participanteId > 0
      ? ` data-participante-id="${participanteId}"`
      : '';
  const hasPhoto = Boolean(contact?.avatarUrl);
  if (!hasPhoto) {
    return `<span class="${className}" data-initial="${escapeHtml(initial)}"${idAttr}>${escapeHtml(initial)}</span>`;
  }
  const src = escapeHtml(avatarImgSrc(contact));
  return `<span class="${className} ${className}--photo" data-initial="${escapeHtml(initial)}"${idAttr}><img src="${src}" alt="" decoding="async" /></span>`;
}

function bindContactAvatars(container) {
  bindContactAvatarImages(container, 'wa-thread-avatar');
}

function previewText(msg) {
  if (!msg) return 'Nenhuma mensagem ainda';
  if (msg.tipo && msg.tipo !== 'text' && !msg.texto) {
    const map = { image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha' };
    return map[msg.tipo] || 'Mensagem';
  }
  const t = String(msg.texto || '').trim();
  if (!t) return 'Mensagem';
  return t.length > 72 ? `${t.slice(0, 71)}…` : t;
}

export function initWhatsappInbox({ onOpenLead } = {}) {
  const screen = document.getElementById('wa-inbox-screen');
  const btnOpen = document.getElementById('btn-whatsapp-inbox');
  const btnClose = document.getElementById('wa-inbox-close');
  const btnRefresh = document.getElementById('wa-inbox-refresh');
  const statusEl = document.getElementById('wa-inbox-status');
  const searchEl = document.getElementById('wa-inbox-search');
  const threadList = document.getElementById('wa-thread-list');
  const chatEmpty = document.getElementById('wa-chat-empty');
  const chatActive = document.getElementById('wa-chat-active');
  const chatName = document.getElementById('wa-chat-name');
  const chatFunil = document.getElementById('wa-chat-funil');
  const chatPhone = document.getElementById('wa-chat-phone');
  const chatAvatar = document.getElementById('wa-chat-avatar');
  const chatMessages = document.getElementById('wa-chat-messages');
  const chatForm = document.getElementById('wa-chat-form');
  const chatInput = document.getElementById('wa-chat-input');
  const btnOpenLead = document.getElementById('wa-chat-open-lead');
  const btnChatSync = document.getElementById('wa-chat-sync');
  const btnChatBack = document.getElementById('wa-chat-back');

  if (!screen || !btnOpen) return;

  let threads = [];
  let activeThread = null;
  let messages = [];
  let ws = null;
  let wsRetries = 0;
  let wsConnected = false;
  let pollTimer = null;
  const POLL_INTERVAL_MS = 5000;
  let filter = '';
  let inboxStatus = null;
  let unbindReactions = null;
  let unbindCompose = null;
  let draftInputTimer = null;
  let lastThreadsContentKey = '';

  function threadsContentKey(list) {
    return (list || [])
      .map((t) => {
        const preview = previewText(t.ultimaMensagem);
        const time = t.ultimaMensagem?.enviadoEm || '';
        const funil = t.etapaFunil?.titulo || '';
        const hasAvatar = t.avatarUrl ? '1' : '0';
        return `${t.participanteId}|${t.participanteNome}|${preview}|${time}|${funil}|${hasAvatar}`;
      })
      .join('\n');
  }

  function updateThreadActiveState() {
    if (!threadList) return;
    const activeId = activeThread?.participanteId;
    threadList.querySelectorAll('.wa-thread').forEach((btn) => {
      const id = Number(btn.dataset.participanteId);
      btn.classList.toggle('wa-thread--active', id === activeId);
    });
  }

  function persistActiveDraft() {
    if (!activeThread?.participanteId || !chatInput) return;
    writeWhatsappDraft(activeThread.participanteId, chatInput.value);
  }

  function loadDraftForThread(participanteId) {
    if (!chatInput) return;
    chatInput.value = readWhatsappDraft(participanteId);
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scheduleDraftSave() {
    if (!activeThread?.participanteId || !chatInput) return;
    clearTimeout(draftInputTimer);
    draftInputTimer = setTimeout(() => {
      writeWhatsappDraft(activeThread.participanteId, chatInput.value);
    }, 250);
  }

  function isChatNearBottom(threshold = 96) {
    if (!chatMessages) return true;
    const distance =
      chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    return distance <= threshold;
  }

  function messagesFingerprint(list) {
    return (list || [])
      .map((m) => {
        const reactions = (m.reacoes || [])
          .map((r) => `${r.autorKey}:${r.emoji}`)
          .sort()
          .join(';');
        return `${m.id}|${m.evolutionMessageId || ''}|${m.texto || ''}|${m.tipo}|${stableMediaRef(m)}|${reactions}`;
      })
      .join('\n');
  }

  function isOpen() {
    return !screen.classList.contains('hidden');
  }

  function renderMessageBubble(m) {
    const out = m.direcao === 'out';
    const media = renderWhatsappMediaHtml(m, { classPrefix: 'wa' });
    const text = shouldShowWhatsappBubbleText(m) ? renderWhatsappBubbleTextHtml(m, { classPrefix: 'wa' }) : '';
    const mods = bubbleModifierClasses(m, { classPrefix: 'wa' });
    const bubble = `
      <article class="wa-bubble ${out ? 'wa-bubble--out' : 'wa-bubble--in'}${mods ? ` ${mods}` : ''}" data-msg-id="${m.id}">
        <time class="wa-bubble-time">${fmtDate(m.enviadoEm)}</time>
        ${media}
        ${text}
      </article>`;
    return wrapWhatsappBubble(bubble, {
      out,
      reacoes: m.reacoes,
      wrapClass: 'wa-bubble-wrap',
      reactionsClass: 'wa-bubble-reactions',
      msgId: m.id,
    });
  }

  async function reactToMessage(mensagemId, emoji) {
    if (!activeThread) return;
    try {
      const result = await sendWhatsappInboxReaction(activeThread.participanteId, mensagemId, emoji);
      updateMessageReactions(mensagemId, result.reacoes, result.evolutionMessageId);
    } catch (err) {
      alert(err.message);
    }
  }

  function bindReactionControls() {
    unbindReactions?.();
    if (!chatMessages) return;
    unbindReactions = bindWhatsappReactionControls(chatMessages, {
      onReact: reactToMessage,
    });
  }

  function renderMessages({ forceBottom = false } = {}) {
    if (!chatMessages) return;
    if (!messages.length) {
      chatMessages.innerHTML =
        '<p class="wa-chat-placeholder">Nenhuma mensagem ainda. Envie a primeira mensagem.</p>';
      return;
    }

    const stickToBottom = forceBottom || isChatNearBottom();
    const prevScrollTop = chatMessages.scrollTop;
    const total = activeThread?.totalMensagens || messages.length;
    const historyHint =
      total <= messages.length
        ? `<p class="wa-chat-history-hint">Início da conversa · ${messages.length} mensagem(ns) carregada(s)</p>`
        : `<p class="wa-chat-history-hint">${messages.length} de ${total} mensagens · role para cima para ver mais antigas</p>`;

    chatMessages.innerHTML = historyHint + messages.map(renderMessageBubble).join('');

    if (stickToBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
      chatMessages.scrollTop = prevScrollTop;
    }

    void hydrateWhatsappMedia(chatMessages);
    retryPendingWhatsappMedia(chatMessages);
    bindReactionControls();
  }

  function filteredThreads() {
    const q = filter.trim().toLowerCase();
    if (!q) return threads;
    const qDigits = q.replace(/\D/g, '');
    return threads.filter((t) => {
      const name = String(t.participanteNome || '').toLowerCase();
      const nameMatch = name.includes(q);
      const phoneDigits = String(t.telefone || '').replace(/\D/g, '');
      const phoneMatch = qDigits.length > 0 && phoneDigits.includes(qDigits);
      return nameMatch || phoneMatch;
    });
  }

  function renderThreads({ force = false } = {}) {
    if (!threadList) return;
    const q = filter.trim().toLowerCase();
    const list = q ? filteredThreads() : threads;

    if (!list.length) {
      const emptyKey = `empty:${q}`;
      if (!force && emptyKey === lastThreadsContentKey) return;
      lastThreadsContentKey = emptyKey;
      threadList.innerHTML = q
        ? '<p class="wa-thread-empty">Nenhum lead encontrado para esta busca.</p>'
        : '<p class="wa-thread-empty">Nenhum lead com WhatsApp neste evento.</p>';
      return;
    }

    const contentKey = `${q}::${threadsContentKey(list)}`;
    if (!force && contentKey === lastThreadsContentKey) {
      updateThreadActiveState();
      return;
    }
    lastThreadsContentKey = contentKey;

    threadList.innerHTML = list
      .map((t) => {
        const active = activeThread?.participanteId === t.participanteId;
        const preview = previewText(t.ultimaMensagem);
        const time = t.ultimaMensagem?.enviadoEm ? fmtDate(t.ultimaMensagem.enviadoEm) : '';
        return `
        <button type="button" class="wa-thread${active ? ' wa-thread--active' : ''}" data-participante-id="${t.participanteId}" role="listitem">
          ${renderContactAvatar(t)}
          <span class="wa-thread-body">
            <span class="wa-thread-top">
              <strong class="wa-thread-name">${escapeHtml(t.participanteNome)}</strong>
              <time class="wa-thread-time">${escapeHtml(time)}</time>
            </span>
            <span class="wa-thread-preview">${escapeHtml(preview)}</span>
          </span>
        </button>`;
      })
      .join('');

    threadList.querySelectorAll('.wa-thread').forEach((btn) => {
      btn.addEventListener('click', () => selectThread(Number(btn.dataset.participanteId)));
    });
    bindContactAvatars(threadList);
  }

  function updateStatus(status) {
    if (!statusEl) return;
    if (status) inboxStatus = status;
    const current = inboxStatus || status;
    if (!current?.configured) {
      statusEl.textContent = 'Evolution API não configurada.';
      return;
    }
    if (!current.connected) {
      statusEl.textContent = 'WhatsApp desconectado — conecte pelo botão no menu superior.';
      return;
    }
    const wsLabel = wsConnected ? 'tempo real ativo' : 'atualizando a cada 5s';
    const q = filter.trim();
    if (q) {
      statusEl.textContent = `${filteredThreads().length} de ${threads.length} lead(s) · ${wsLabel}`;
      return;
    }
    statusEl.textContent = `${threads.length} lead(s) com WhatsApp · ${wsLabel}`;
  }

  function upsertThreadFromMessage(participanteId, mensagem) {
    if (!participanteId || !mensagem) return null;
    let thread = threads.find((t) => t.participanteId === participanteId);
    if (!thread) return null;

    thread.ultimaMensagem = {
      texto: mensagem.texto,
      direcao: mensagem.direcao,
      tipo: mensagem.tipo,
      enviadoEm: mensagem.enviadoEm,
    };
    thread.totalMensagens = (thread.totalMensagens || 0) + 1;
    threads = [...threads].sort((a, b) => {
      const ta = a.ultimaMensagem?.enviadoEm ? new Date(a.ultimaMensagem.enviadoEm).getTime() : 0;
      const tb = b.ultimaMensagem?.enviadoEm ? new Date(b.ultimaMensagem.enviadoEm).getTime() : 0;
      return tb - ta || a.participanteNome.localeCompare(b.participanteNome, 'pt-BR');
    });
    renderThreads();
    return thread;
  }

  async function loadInbox() {
    try {
      const data = await fetchWhatsappInbox();
      threads = data.threads || [];
      if (activeThread) {
        const refreshed = threads.find((t) => t.participanteId === activeThread.participanteId);
        if (refreshed) {
          activeThread = refreshed;
          renderChatFunil(activeThread);
        }
      }
      updateStatus(data.status);
      renderThreads();
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
    }
  }

  async function loadThreadMessages(participanteId, { silent = false, forceBottom = false, prepare = false } = {}) {
    const data = await fetchWhatsappThreadMessages(participanteId, { prepare });
    mergeMessages(data.mensagens || [], { silent, forceBottom });
    if (!silent && activeThread?.participanteId === participanteId) {
      activeThread = threads.find((t) => t.participanteId === participanteId) || activeThread;
    }
  }

  async function syncActiveThread() {
    if (!activeThread || !btnChatSync) return;
    const participanteId = activeThread.participanteId;
    const label = btnChatSync.textContent;
    btnChatSync.disabled = true;
    btnChatSync.textContent = 'Sincronizando…';
    if (chatMessages) {
      chatMessages.innerHTML =
        '<p class="wa-chat-placeholder">Sincronizando mensagens, mídias e reações…<br><small>Últimos 5 dias na Evolution. Pode levar até 1 minuto.</small></p>';
    }
    try {
      const data = await syncWhatsappInboxThread(participanteId, { days: 5 });
      mergeMessages(data.mensagens || [], { forceBottom: true });
      const parts = [];
      if (data.history?.total) parts.push(`${data.history.total} no histórico`);
      if (data.history?.imported) parts.push(`${data.history.imported} novas`);
      if (data.reactions?.applied) parts.push(`${data.reactions.applied} reações`);
      if (data.media?.mirrored) parts.push(`${data.media.mirrored} mídias baixadas`);
      if (data.media?.failed) parts.push(`${data.media.failed} mídias falharam`);
      if (data.media?.pending) parts.push(`${data.media.pending} mídias pendentes`);
      if (data.errors?.length) {
        statusEl.textContent = `Sync com avisos: ${data.errors[0]}`;
      } else if (parts.length) {
        statusEl.textContent = `Sincronizado (${data.days || 5} dias): ${parts.join(', ')}`;
      } else {
        statusEl.textContent = 'Conversa sincronizada — nada novo no período';
      }
      await loadInbox();
    } catch (err) {
      if (chatMessages) {
        chatMessages.innerHTML = `<p class="wa-chat-placeholder">${escapeHtml(err.message)}</p>`;
      }
      if (statusEl) statusEl.textContent = err.message;
    } finally {
      btnChatSync.disabled = false;
      btnChatSync.textContent = label;
    }
  }

  function resolveThreadArrecadacaoId(thread) {
    if (!thread) return null;
    if (messages.length) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const arrecadacaoId = Number(messages[i]?.arrecadacaoId);
        if (arrecadacaoId > 0) return arrecadacaoId;
      }
    }
    const ids = thread.arrecadacaoIds || [];
    if (ids.length > 1) return ids[ids.length - 1];
    return thread.primaryArrecadacaoId || null;
  }

  function resolveThreadLeadTipo(thread, arrecadacaoId) {
    if (thread?.leadTipo && thread.leadTipo !== 'contato') return thread.leadTipo;
    return thread?.leadTipo || undefined;
  }

  function showChatPane(show) {
    chatEmpty?.classList.toggle('hidden', show);
    chatActive?.classList.toggle('hidden', !show);
    screen.classList.toggle('wa-inbox-screen--chat-open', show);
  }

  function renderChatFunil(thread) {
    if (!chatFunil) return;
    const etapa = thread?.etapaFunil;
    if (!etapa?.titulo) {
      chatFunil.classList.add('hidden');
      chatFunil.textContent = '';
      chatFunil.style.removeProperty('--funil-color');
      return;
    }
    chatFunil.textContent = etapa.titulo;
    chatFunil.classList.remove('hidden');
    if (etapa.cor) {
      chatFunil.style.setProperty('--funil-color', etapa.cor);
    } else {
      chatFunil.style.removeProperty('--funil-color');
    }
  }

  async function selectThread(participanteId) {
    if (activeThread?.participanteId && activeThread.participanteId !== participanteId) {
      persistActiveDraft();
    }
    const thread = threads.find((t) => t.participanteId === participanteId);
    if (!thread) return;
    activeThread = thread;
    if (chatName) chatName.textContent = thread.participanteNome;
    renderChatFunil(thread);
    btnOpenLead?.classList.toggle(
      'hidden',
      !(thread?.primaryArrecadacaoId || thread?.arrecadacaoIds?.length) ||
        thread?.leadTipo === 'contato',
    );
    if (chatPhone) {
      chatPhone.textContent = thread.telefone ? formatPhoneDisplay(thread.telefone) : '';
    }
    if (chatAvatar) {
      mountContactAvatar(chatAvatar, thread, 'wa-chat-avatar');
    }
    showChatPane(true);
    updateThreadActiveState();
    loadDraftForThread(participanteId);
    chatMessages.innerHTML = '<p class="wa-chat-placeholder">Carregando conversa…</p>';
    try {
      messages = [];
      await loadThreadMessages(participanteId, { forceBottom: true, prepare: false });
      void loadThreadMessages(participanteId, { silent: true, prepare: true }).catch(() => {});
    } catch (err) {
      chatMessages.innerHTML = `<p class="wa-chat-placeholder">${escapeHtml(err.message)}</p>`;
    }
  }

  function appendMessage(m) {
    if (!m) return false;
    const exists = messages.some(
      (x) =>
        x.id === m.id ||
        (m.evolutionMessageId && x.evolutionMessageId === m.evolutionMessageId),
    );
    if (exists) return false;
    messages = [...messages, m].sort(
      (a, b) => new Date(a.enviadoEm) - new Date(b.enviadoEm) || a.id - b.id,
    );
    renderMessages({ forceBottom: isChatNearBottom() });
    return true;
  }

  function mergeMessages(list, { silent = false, forceBottom = false } = {}) {
    const map = new Map();
    for (const item of list || []) {
      const key = item.evolutionMessageId || `id:${item.id}`;
      const current = map.get(key);
      if (!current) {
        map.set(key, item);
        continue;
      }
      const newer = item.id > current.id ? item : current;
      const older = item.id > current.id ? current : item;
      const reacoes = (newer.reacoes?.length ? newer.reacoes : older.reacoes) || [];
      map.set(key, { ...newer, reacoes });
    }
    const next = [...map.values()].sort(
      (a, b) => new Date(a.enviadoEm) - new Date(b.enviadoEm) || a.id - b.id,
    );

    if (silent && messagesFingerprint(next) === messagesFingerprint(messages)) {
      return;
    }

    messages = next;
    renderMessages({ forceBottom: forceBottom || isChatNearBottom() });
  }

  function patchMessageReactions(mensagemId, reacoes) {
    if (!chatMessages) return false;
    const wrap = chatMessages.querySelector(`.wa-bubble-wrap[data-msg-id="${mensagemId}"]`);
    if (!wrap) return false;

    const reactionsHtml = renderWhatsappReactions(reacoes, 'wa-bubble-reactions', { msgId: mensagemId });
    const existing = wrap.querySelector('.wa-bubble-reactions');

    if (reactionsHtml) {
      if (existing) {
        existing.outerHTML = reactionsHtml;
      } else {
        wrap.insertAdjacentHTML('beforeend', reactionsHtml);
      }
      wrap.classList.add('wa-bubble-wrap--has-reactions');
    } else if (existing) {
      existing.remove();
      wrap.classList.remove('wa-bubble-wrap--has-reactions');
    }

    bindReactionControls();
    return true;
  }

  function updateMessageReactions(mensagemId, reacoes, evolutionMessageId) {
    const idx = messages.findIndex(
      (m) =>
        m.id === mensagemId ||
        (evolutionMessageId && m.evolutionMessageId === evolutionMessageId),
    );
    if (idx === -1) return;
    messages = [...messages];
    messages[idx] = { ...messages[idx], reacoes: reacoes || [] };
    if (!patchMessageReactions(messages[idx].id, reacoes)) {
      renderMessages();
    }
  }

  function updateMessageMedia(mensagem) {
    if (!mensagem?.id) return;
    const idx = messages.findIndex((m) => m.id === mensagem.id);
    if (idx === -1) return;
    messages = [...messages];
    messages[idx] = { ...messages[idx], ...mensagem };
    if (!patchWhatsappMessageMedia(chatMessages, messages[idx], { classPrefix: 'wa' })) {
      renderMessages();
    }
  }

  function handleWsPayload(payload) {
    if (!payload) return;

    if (payload.type === 'reaction') {
      const { participanteId, mensagemId, evolutionMessageId, reacoes } = payload.data || {};
      if (activeThread?.participanteId === participanteId && (mensagemId || evolutionMessageId)) {
        updateMessageReactions(mensagemId, reacoes, evolutionMessageId);
      }
      return;
    }

    if (payload.type === 'message_media') {
      const { participanteId, mensagem } = payload.data || {};
      if (activeThread?.participanteId === participanteId && mensagem) {
        updateMessageMedia(mensagem);
      }
      return;
    }

    if (payload.type !== 'message') return;
    const { participanteId, mensagem } = payload.data || {};
    if (!mensagem) return;

    const pid = Number(participanteId);
    if (!threads.find((t) => t.participanteId === pid)) {
      loadInbox().catch(() => {});
    } else {
      upsertThreadFromMessage(pid, mensagem);
    }

    if (activeThread?.participanteId === pid) {
      appendMessage(mensagem);
    }
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(wsUrl());
    } catch {
      wsConnected = false;
      updateStatus({ configured: true, connected: true });
      return;
    }

    ws.addEventListener('open', () => {
      wsRetries = 0;
      wsConnected = true;
      updateStatus({ configured: true, connected: true });
    });

    ws.addEventListener('message', (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload?.type === 'connected') return;
        handleWsPayload(payload);
      } catch {
        /* ignore */
      }
    });

    ws.addEventListener('close', () => {
      ws = null;
      wsConnected = false;
      updateStatus({ configured: true, connected: true });
      if (!isOpen()) return;
      const delay = Math.min(30000, 2000 * 2 ** wsRetries++);
      setTimeout(connectWs, delay);
    });

    ws.addEventListener('error', () => {
      wsConnected = false;
      updateStatus({ configured: true, connected: true });
    });
  }

  function disconnectWs() {
    ws?.close();
    ws = null;
    wsConnected = false;
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!isOpen()) return;
      loadInbox();
      if (activeThread && !wsConnected) {
        loadThreadMessages(activeThread.participanteId, { silent: true, prepare: false }).catch(() => {});
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function ensureThread(participanteId) {
    const id = Number(participanteId);
    if (!Number.isInteger(id) || id < 1) return null;
    const existing = threads.find((t) => t.participanteId === id);
    if (existing) return existing;
    try {
      const data = await fetchWhatsappInboxThread(id);
      if (!data?.thread) return null;
      threads = [data.thread, ...threads.filter((t) => t.participanteId !== id)];
      renderThreads();
      return data.thread;
    } catch (_) {
      return null;
    }
  }

  async function openInbox({ participanteId = null } = {}) {
    persistActiveDraft();
    lastThreadsContentKey = '';
    screen.classList.remove('hidden');
    screen.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wa-inbox-open');
    filter = '';
    if (searchEl) searchEl.value = '';
    activeThread = null;
    showChatPane(false);
    await loadInbox();
    connectWs();
    startPolling();
    if (participanteId) {
      const thread = await ensureThread(participanteId);
      if (thread) {
        await selectThread(thread.participanteId);
      } else {
        alert(
          'Não foi possível abrir a conversa. Verifique se o contato tem WhatsApp cadastrado.',
        );
      }
    }
  }

  async function openThread(participanteId) {
    await openInbox({ participanteId: Number(participanteId) });
  }

  function closeInbox() {
    persistActiveDraft();
    lastThreadsContentKey = '';
    clearTimeout(draftInputTimer);
    draftInputTimer = null;
    screen.classList.add('hidden');
    screen.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wa-inbox-open');
    unbindReactions?.();
    unbindReactions = null;
    unbindCompose?.();
    unbindCompose = null;
    disconnectWs();
    stopPolling();
  }

  async function deliverOutboundMessage(payload) {
    if (!activeThread) return null;
    const { mensagem } = await sendWhatsappInboxMessage(activeThread.participanteId, payload);
    if (mensagem) {
      appendMessage(mensagem);
      upsertThreadFromMessage(activeThread.participanteId, mensagem);
    }
    await loadInbox();
    return mensagem;
  }

  unbindCompose?.();
  unbindCompose = initWhatsappCompose({
    formEl: chatForm,
    inputEl: chatInput,
    fileInputId: 'wa-chat-file',
    attachBtnId: 'wa-chat-attach',
    micBtnId: 'wa-chat-mic',
    sendBtnId: 'wa-chat-send',
    recordingPanelId: 'wa-chat-recording',
    dropZoneEl: chatActive,
    onSendText: async (text) => {
      await deliverOutboundMessage({ text });
      if (activeThread?.participanteId) clearWhatsappDraft(activeThread.participanteId);
    },
    onSendMedia: async (payload) => {
      await deliverOutboundMessage(payload);
      if (activeThread?.participanteId) {
        writeWhatsappDraft(activeThread.participanteId, chatInput?.value || '');
      }
    },
  });

  btnOpen.addEventListener('click', () => openInbox());
  btnClose?.addEventListener('click', closeInbox);
  btnRefresh?.addEventListener('click', loadInbox);
  searchEl?.addEventListener('input', () => {
    filter = searchEl.value;
    renderThreads();
    updateStatus();
  });
  btnChatBack?.addEventListener('click', () => {
    persistActiveDraft();
    activeThread = null;
    if (chatInput) {
      chatInput.value = '';
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    renderChatFunil(null);
    showChatPane(false);
    renderThreads();
  });
  btnOpenLead?.addEventListener('click', async () => {
    if (!activeThread) return;
    const arrecadacaoId = resolveThreadArrecadacaoId(activeThread);
    if (!arrecadacaoId) return;
    const tipo = resolveThreadLeadTipo(activeThread, arrecadacaoId);
    closeInbox();
    await onOpenLead?.(arrecadacaoId, { tipo });
  });
  btnChatSync?.addEventListener('click', () => {
    syncActiveThread();
  });

  chatInput?.addEventListener('input', scheduleDraftSave);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeInbox();
  });

  onEventoChange(() => {
    if (isOpen()) loadInbox();
  });

  return { openInbox, openThread, closeInbox, reload: loadInbox };
}
