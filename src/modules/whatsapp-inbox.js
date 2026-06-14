import {
  fetchWhatsappInbox,
  fetchWhatsappThreadMessages,
  syncWhatsappInboxThread,
  sendWhatsappInboxMessage,
  sendWhatsappInboxReaction,
} from '../lib/api.js';
import { fmtDate, formatPhoneDisplay, escapeHtml } from '../lib/format.js';
import { wrapWhatsappBubble, renderWhatsappReactions } from '../lib/whatsapp-reactions.js';
import { bindWhatsappReactionControls } from '../lib/whatsapp-reactions-ui.js';
import { renderWhatsappMediaHtml, hydrateWhatsappMedia, shouldShowWhatsappBubbleText } from '../lib/whatsapp-media.js';
import { onEventoChange } from '../lib/evento.js';

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
  const chatPhone = document.getElementById('wa-chat-phone');
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
  let unbindReactions = null;

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
        return `${m.id}|${m.evolutionMessageId || ''}|${m.texto || ''}|${m.tipo}|${m.midiaUrl || ''}|${reactions}`;
      })
      .join('\n');
  }

  function isOpen() {
    return !screen.classList.contains('hidden');
  }

  function renderMessageBubble(m) {
    const out = m.direcao === 'out';
    const media = renderWhatsappMediaHtml(m, { classPrefix: 'wa' });
    const text = shouldShowWhatsappBubbleText(m)
      ? `<p class="wa-bubble-text">${escapeHtml(m.texto)}</p>`
      : '';
    const bubble = `
      <article class="wa-bubble ${out ? 'wa-bubble--out' : 'wa-bubble--in'}" data-msg-id="${m.id}">
        <time class="wa-bubble-time">${fmtDate(m.enviadoEm)}</time>
        ${text}
        ${media}
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
        '<p class="wa-chat-placeholder">Nenhuma mensagem ainda. Envie a primeira ou sincronize no lead.</p>';
      return;
    }

    const stickToBottom = forceBottom || isChatNearBottom();
    const prevScrollTop = chatMessages.scrollTop;

    chatMessages.innerHTML = messages.map(renderMessageBubble).join('');

    if (stickToBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
      chatMessages.scrollTop = prevScrollTop;
    }

    void hydrateWhatsappMedia(chatMessages);
    bindReactionControls();
  }

  function renderThreads() {
    if (!threadList) return;
    const q = filter.trim().toLowerCase();
    const list = q
      ? threads.filter(
          (t) =>
            t.participanteNome.toLowerCase().includes(q) ||
            String(t.telefone || '').includes(q.replace(/\D/g, '')),
        )
      : threads;

    if (!list.length) {
      threadList.innerHTML =
        '<p class="wa-thread-empty">Nenhum lead com WhatsApp neste evento.</p>';
      return;
    }

    threadList.innerHTML = list
      .map((t) => {
        const active = activeThread?.participanteId === t.participanteId;
        const preview = previewText(t.ultimaMensagem);
        const time = t.ultimaMensagem?.enviadoEm ? fmtDate(t.ultimaMensagem.enviadoEm) : '';
        const initial = (t.participanteNome || '?').trim().charAt(0).toUpperCase();
        return `
        <button type="button" class="wa-thread${active ? ' wa-thread--active' : ''}" data-participante-id="${t.participanteId}" role="listitem">
          <span class="wa-thread-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
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
  }

  function updateStatus(status) {
    if (!statusEl) return;
    if (!status?.configured) {
      statusEl.textContent = 'Evolution API não configurada.';
      return;
    }
    if (!status.connected) {
      statusEl.textContent = 'WhatsApp desconectado — conecte pelo botão no menu superior.';
      return;
    }
    const wsLabel = wsConnected ? 'tempo real ativo' : 'atualizando a cada 5s';
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
      updateStatus(data.status);
      renderThreads();
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
    }
  }

  async function loadThreadMessages(participanteId, { silent = false, forceBottom = false } = {}) {
    const data = await fetchWhatsappThreadMessages(participanteId);
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
        '<p class="wa-chat-placeholder">Sincronizando mensagens, mídias e reações…<br><small>Isso pode levar até um minuto.</small></p>';
    }
    try {
      const data = await syncWhatsappInboxThread(participanteId, { days: 14 });
      mergeMessages(data.mensagens || [], { forceBottom: true });
      const parts = [];
      if (data.history?.imported) parts.push(`${data.history.imported} msg`);
      if (data.reactions?.applied) parts.push(`${data.reactions.applied} reações`);
      if (data.media?.mirrored) parts.push(`${data.media.mirrored} mídias`);
      if (data.errors?.length) {
        statusEl.textContent = `Sync com avisos: ${data.errors[0]}`;
      } else if (parts.length) {
        statusEl.textContent = `Sincronizado: ${parts.join(', ')}`;
      } else {
        statusEl.textContent = 'Conversa sincronizada';
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

  function showChatPane(show) {
    chatEmpty?.classList.toggle('hidden', show);
    chatActive?.classList.toggle('hidden', !show);
    screen.classList.toggle('wa-inbox-screen--chat-open', show);
  }

  async function selectThread(participanteId) {
    const thread = threads.find((t) => t.participanteId === participanteId);
    if (!thread) return;
    activeThread = thread;
    if (chatName) chatName.textContent = thread.participanteNome;
    if (chatPhone) {
      chatPhone.textContent = thread.telefone ? formatPhoneDisplay(thread.telefone) : '';
    }
    showChatPane(true);
    renderThreads();
    chatMessages.innerHTML = '<p class="wa-chat-placeholder">Carregando…</p>';
    try {
      messages = [];
      await loadThreadMessages(participanteId, { forceBottom: true });
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
    renderMessages();
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
        loadThreadMessages(activeThread.participanteId, { silent: true }).catch(() => {});
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function openInbox() {
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
  }

  function closeInbox() {
    screen.classList.add('hidden');
    screen.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wa-inbox-open');
    unbindReactions?.();
    unbindReactions = null;
    disconnectWs();
    stopPolling();
  }

  async function submitMessage(e) {
    e.preventDefault();
    if (!activeThread) return;
    const text = chatInput?.value.trim() || '';
    if (!text) return;

    const btn = chatForm?.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const { mensagem } = await sendWhatsappInboxMessage(activeThread.participanteId, text);
      if (mensagem) {
        appendMessage(mensagem);
        upsertThreadFromMessage(activeThread.participanteId, mensagem);
      }
      if (chatInput) chatInput.value = '';
      await loadInbox();
    } catch (err) {
      alert(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  btnOpen.addEventListener('click', openInbox);
  btnClose?.addEventListener('click', closeInbox);
  btnRefresh?.addEventListener('click', loadInbox);
  searchEl?.addEventListener('input', () => {
    filter = searchEl.value;
    renderThreads();
  });
  chatForm?.addEventListener('submit', submitMessage);
  btnChatBack?.addEventListener('click', () => {
    activeThread = null;
    showChatPane(false);
    renderThreads();
  });
  btnOpenLead?.addEventListener('click', () => {
    if (!activeThread?.primaryArrecadacaoId) return;
    closeInbox();
    onOpenLead?.(activeThread.primaryArrecadacaoId);
  });
  btnChatSync?.addEventListener('click', () => {
    syncActiveThread();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeInbox();
  });

  onEventoChange(() => {
    if (isOpen()) loadInbox();
  });

  return { openInbox, closeInbox, reload: loadInbox };
}
