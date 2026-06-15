import { escapeHtml } from './format.js';

const API_BASE = import.meta.env.VITE_API_URL || '';
const mediaBlobCache = new Map();

function resolveMediaFetchUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

function mediaAttrs(m) {
  if (!m?.midiaUrl || !m?.id) return '';
  const resolved = resolveMediaFetchUrl(m.midiaUrl);
  const mime = m.midiaMimetype ? ` data-midia-mimetype="${escapeHtml(m.midiaMimetype)}"` : '';
  const tipo = m.tipo ? ` data-midia-tipo="${escapeHtml(m.tipo)}"` : '';
  return ` data-midia-id="${m.id}" data-midia-url="${escapeHtml(resolved)}"${mime}${tipo}`;
}

function shellAttrs(m) {
  if (!m?.id) return '';
  const tipo = m.tipo ? ` data-midia-tipo="${escapeHtml(m.tipo)}"` : '';
  return ` data-midia-id="${m.id}"${tipo}`;
}

function cacheKeyForNode(node) {
  return node.dataset.midiaId || node.dataset.midiaUrl || '';
}

function mediaTipoFromNode(node) {
  return (
    node?.dataset?.midiaTipo ||
    node?.closest('[data-midia-tipo]')?.dataset?.midiaTipo ||
    ''
  );
}

function rememberObjectUrl(key, objectUrl) {
  if (!key || !objectUrl) return;
  const prev = mediaBlobCache.get(key);
  if (prev && prev !== objectUrl) URL.revokeObjectURL(prev);
  mediaBlobCache.set(key, objectUrl);
}

export function shouldShowWhatsappBubbleText(m) {
  if (!m?.texto) return false;
  if (m.tipo === 'audio' || m.tipo === 'sticker') return false;
  const t = String(m.texto).trim();
  if (['[Figurinha]', '[Áudio]', '[Vídeo]', '[Documento]', '[Mensagem não suportada]'].includes(t)) {
    return false;
  }
  return true;
}

export function renderWhatsappMediaHtml(m, { classPrefix = 'wa' } = {}) {
  if (!m || m.tipo === 'text' || m.tipo === 'reaction') return '';
  if (!m.midiaUrl && !['image', 'sticker', 'audio', 'video', 'document'].includes(m.tipo)) return '';

  const attrs = mediaAttrs(m);
  const shell = shellAttrs(m);
  const url = m.midiaUrl ? escapeHtml(resolveMediaFetchUrl(m.midiaUrl)) : '';
  const tipo = m.tipo;

  if (tipo === 'image' || tipo === 'sticker') {
    if (url) {
      const stickerClass = tipo === 'sticker' ? ` ${classPrefix}-bubble-sticker` : '';
      return `<img class="${classPrefix}-bubble-img${stickerClass}"${attrs} alt="" decoding="async" loading="eager" />`;
    }
    return `<span class="${classPrefix}-bubble-media-pending">Imagem indisponível</span>`;
  }

  if (tipo === 'audio' && url) {
    return `<div class="${classPrefix}-bubble-audio-shell"${shell}>
      <span class="${classPrefix}-bubble-audio-label">Áudio</span>
      <audio class="${classPrefix}-bubble-audio"${attrs} controls preload="auto"></audio>
    </div>`;
  }

  if (tipo === 'video' && url) {
    return `<div class="${classPrefix}-bubble-video-shell"${shell}>
      <video class="${classPrefix}-bubble-video"${attrs} controls preload="metadata"></video>
    </div>`;
  }

  if (!url) {
    return `<span class="${classPrefix}-bubble-media-pending">Mídia indisponível</span>`;
  }

  const label =
    tipo === 'document'
      ? 'Abrir arquivo'
      : tipo === 'audio'
        ? 'Ouvir áudio'
        : tipo === 'video'
          ? 'Ver vídeo'
          : 'Abrir arquivo';

  return `<a class="${classPrefix}-bubble-media" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function mediaErrorMessage(status, tipo) {
  if (status === 401) return 'Faça login novamente para ver a mídia';
  if (tipo === 'audio') {
    return status === 404
      ? 'Áudio não baixado — use Sincronizar no chat'
      : 'Não foi possível carregar o áudio';
  }
  if (tipo === 'video') {
    return status === 404
      ? 'Vídeo não baixado — use Sincronizar no chat'
      : 'Não foi possível carregar o vídeo';
  }
  if (status === 404) return 'Imagem não baixada — use Sincronizar no chat';
  return 'Não foi possível carregar a mídia';
}

function showWhatsappMediaPending(node, message, tipoOverride = '') {
  const mediaNode = node?.matches?.('audio,video,img')
    ? node
    : node?.querySelector?.('audio,video,img') || node;
  if (!mediaNode?.isConnected || mediaNode.dataset.fallbackShown) return;

  const shell = mediaNode.closest('[class*="bubble-audio-shell"], [class*="bubble-video-shell"]');
  const tipo = tipoOverride || mediaTipoFromNode(mediaNode);
  const url = mediaNode.dataset.midiaUrl || '';
  const label = message || mediaErrorMessage(404, tipo);

  mediaNode.dataset.fallbackShown = '1';
  const pending = document.createElement('div');
  pending.className = 'wa-bubble-media-pending-block';
  pending.innerHTML = `<span class="wa-bubble-media-pending">${escapeHtml(label)}</span>`;
  if (url) {
    pending.innerHTML += `<a class="wa-bubble-media" href="${escapeHtml(resolveMediaFetchUrl(url))}" target="_blank" rel="noopener noreferrer">Abrir mídia</a>`;
  }
  if (shell) shell.replaceWith(pending);
  else mediaNode.replaceWith(pending);
}

async function fetchMediaBlob(url) {
  const res = await fetch(resolveMediaFetchUrl(url), { credentials: 'include' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const headerType = res.headers.get('content-type');
  if (headerType && (!blob.type || blob.type === 'application/octet-stream')) {
    return new Blob([await blob.arrayBuffer()], { type: headerType.trim() });
  }
  return blob;
}

function blobForNode(node, blob) {
  const preferred = (node.dataset.midiaMimetype || blob.type || '').trim();
  if (!preferred || preferred === blob.type) return blob;
  return new Blob([blob], { type: preferred });
}

function markMediaReady(mediaNode) {
  mediaNode.dataset.hydrated = '1';
  mediaNode
    .closest('[class*="bubble-audio-shell"], [class*="bubble-video-shell"]')
    ?.classList.add('is-ready');
}

function tryDirectMediaSrc(mediaNode, directUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) markMediaReady(mediaNode);
      resolve(ok);
    };

    mediaNode.addEventListener('loadedmetadata', () => finish(true), { once: true });
    mediaNode.addEventListener('canplay', () => finish(true), { once: true });
    mediaNode.addEventListener('error', () => finish(false), { once: true });
    mediaNode.src = directUrl;
    mediaNode.load();
    const timer = setTimeout(() => finish(mediaNode.readyState >= 1), 6000);
  });
}

export function stableMediaRef(m) {
  if (!m?.midiaUrl) return '';
  return String(m.midiaUrl).split('?')[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyMediaToNode(node, attempt = 0) {
  const mediaNode = node.matches('audio,video,img') ? node : node.querySelector('audio,video,img');
  if (!mediaNode) return;

  const url = mediaNode.dataset.midiaUrl;
  if (!url || mediaNode.dataset.fallbackShown) return;

  const key = cacheKeyForNode(mediaNode);
  const tipo = mediaTipoFromNode(mediaNode);
  const directUrl = resolveMediaFetchUrl(url);
  const tag = mediaNode.tagName;

  if (tag === 'AUDIO' || tag === 'VIDEO') {
    const cached = key ? mediaBlobCache.get(key) : null;
    if (cached) {
      mediaNode.src = cached;
      mediaNode.load();
      if (await tryDirectMediaSrc(mediaNode, cached)) return;
    }

    if (attempt === 0 && (await tryDirectMediaSrc(mediaNode, directUrl))) return;

    try {
      const blob = blobForNode(mediaNode, await fetchMediaBlob(url));
      const objectUrl = URL.createObjectURL(blob);
      rememberObjectUrl(key, objectUrl);
      if (await tryDirectMediaSrc(mediaNode, objectUrl)) return;
      throw Object.assign(new Error('decode failed'), { status: 404 });
    } catch (err) {
      if (attempt < 4) {
        await sleep(800 * (attempt + 1));
        return applyMediaToNode(node, attempt + 1);
      }
      showWhatsappMediaPending(mediaNode, mediaErrorMessage(err.status, tipo), tipo);
    }
    return;
  }

  const cached = key ? mediaBlobCache.get(key) : null;
  if (cached) {
    mediaNode.src = cached;
    markMediaReady(mediaNode);
    return;
  }

  try {
    const blob = blobForNode(mediaNode, await fetchMediaBlob(url));
    const objectUrl = URL.createObjectURL(blob);
    rememberObjectUrl(key, objectUrl);
    mediaNode.src = objectUrl;
    markMediaReady(mediaNode);
  } catch (err) {
    if (attempt < 4) {
      await sleep(600 * (attempt + 1));
      return applyMediaToNode(node, attempt + 1);
    }
    showWhatsappMediaPending(mediaNode, mediaErrorMessage(err.status, tipo), tipo);
  }
}

export function patchWhatsappMessageMedia(container, mensagem, { classPrefix = 'wa' } = {}) {
  if (!container || !mensagem?.id) return false;
  const wrapClass = classPrefix === 'wa' ? 'wa-bubble-wrap' : 'lw-whatsapp-bubble-wrap';
  const bubbleClass = classPrefix === 'wa' ? 'wa-bubble' : 'lw-whatsapp-bubble';
  const timeClass = classPrefix === 'wa' ? 'wa-bubble-time' : 'lw-whatsapp-time';

  const wrap = container.querySelector(`.${wrapClass}[data-msg-id="${mensagem.id}"]`);
  if (!wrap) return false;

  const bubble = wrap.querySelector(`.${bubbleClass}`);
  if (!bubble) return false;

  const selector = [
    `.${classPrefix}-bubble-img`,
    `.${classPrefix}-bubble-sticker`,
    `.${classPrefix}-bubble-audio-shell`,
    `.${classPrefix}-bubble-video-shell`,
    `.${classPrefix}-bubble-audio`,
    `.${classPrefix}-bubble-video`,
    `.${classPrefix}-bubble-media-pending`,
    `.${classPrefix}-bubble-media-pending-block`,
    `.${classPrefix}-bubble-media`,
  ].join(', ');

  const oldMedia = bubble.querySelector(selector);
  const mediaHtml = renderWhatsappMediaHtml(mensagem, { classPrefix });
  if (!mediaHtml) return false;

  if (oldMedia) {
    oldMedia.outerHTML = mediaHtml;
  } else {
    const time = bubble.querySelector(`.${timeClass}`);
    if (time) time.insertAdjacentHTML('afterend', mediaHtml);
    else bubble.insertAdjacentHTML('afterbegin', mediaHtml);
  }

  void hydrateWhatsappMedia(bubble);
  return true;
}

export async function hydrateWhatsappMedia(container) {
  if (!container) return;

  const nodes = container.querySelectorAll(
    [
      'img[data-midia-url]:not([data-hydrated]):not([data-fallback-shown])',
      'audio[data-midia-url]:not([data-hydrated]):not([data-fallback-shown])',
      'video[data-midia-url]:not([data-hydrated]):not([data-fallback-shown])',
      '.wa-bubble-audio-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.lw-whatsapp-bubble-audio-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.wa-bubble-video-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.lw-whatsapp-bubble-video-shell:not(.is-ready):not(:has([data-fallback-shown]))',
    ].join(', '),
  );

  await Promise.all([...nodes].map((node) => applyMediaToNode(node)));
}

const mediaRetryTimers = new WeakMap();

export function retryPendingWhatsappMedia(container, { delays = [500, 1500, 4000, 10000, 20000] } = {}) {
  if (!container) return;

  const prev = mediaRetryTimers.get(container);
  if (prev) prev.forEach((id) => clearTimeout(id));

  const timers = delays.map((delay) =>
    setTimeout(() => {
      void hydrateWhatsappMedia(container);
    }, delay),
  );
  mediaRetryTimers.set(container, timers);
}
