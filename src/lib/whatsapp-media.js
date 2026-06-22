import { escapeHtml } from './format.js';
import { hydrateLinkPreviews } from './whatsapp-bubble-text.js';

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

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function seedFromId(id) {
  let hash = 0;
  for (const char of String(id || '0')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash || 1;
}

function randomBarHeight(seed, index) {
  const value = Math.sin(seed * 0.013 + index * 0.71) * 10000;
  return 18 + (Math.abs(value) % 72);
}

function buildAudioWaveformHtml(midiaId, classPrefix) {
  const seed = seedFromId(midiaId);
  const maxHeight = 24;
  return Array.from({ length: 38 }, (_, index) => {
    const height = randomBarHeight(seed, index);
    const px = Math.max(3, Math.round((height / 100) * maxHeight));
    return `<span class="${classPrefix}-bubble-audio-bar" style="height:${px}px"></span>`;
  }).join('');
}

const AUDIO_PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const AUDIO_PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

function renderAudioPlayerHtml(m, { classPrefix, url, attrs, shell }) {
  const wave = buildAudioWaveformHtml(m.id, classPrefix);
  return `<div class="${classPrefix}-bubble-audio-shell"${shell}>
    <div class="${classPrefix}-bubble-audio-player">
      <button type="button" class="${classPrefix}-bubble-audio-play" aria-label="Reproduzir" disabled>
        <span class="${classPrefix}-bubble-audio-icon ${classPrefix}-bubble-audio-icon--play">${AUDIO_PLAY_ICON}</span>
        <span class="${classPrefix}-bubble-audio-icon ${classPrefix}-bubble-audio-icon--pause is-hidden">${AUDIO_PAUSE_ICON}</span>
      </button>
      <div class="${classPrefix}-bubble-audio-body">
        <div class="${classPrefix}-bubble-audio-wave" role="slider" aria-label="Progresso do áudio" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
          ${wave}
        </div>
        <span class="${classPrefix}-bubble-audio-time">0:00</span>
      </div>
      <audio class="${classPrefix}-bubble-audio"${attrs} preload="auto"></audio>
    </div>
  </div>`;
}

let activeAudioElement = null;

function setAudioIconState(playIcon, pauseIcon, paused) {
  playIcon?.classList.toggle('is-hidden', !paused);
  pauseIcon?.classList.toggle('is-hidden', paused);
}

function enableAudioShell(shell, audio) {
  if (!shell || !audio) return;
  shell.classList.add('is-ready');
  shell.classList.remove('is-error');
  const playBtn = shell.querySelector('[class*="bubble-audio-play"]');
  if (playBtn) playBtn.disabled = false;
  syncAudioUi(audio);
}

function syncAudioUi(audio) {
  const shell = audio?.closest?.('[class*="bubble-audio-shell"]');
  if (!shell) return;

  const playBtn = shell.querySelector('[class*="bubble-audio-play"]');
  const playIcon = shell.querySelector('[class*="bubble-audio-icon--play"]');
  const pauseIcon = shell.querySelector('[class*="bubble-audio-icon--pause"]');
  const timeEl = shell.querySelector('[class*="bubble-audio-time"]');
  const bars = shell.querySelectorAll('[class*="bubble-audio-bar"]');
  const wave = shell.querySelector('[class*="bubble-audio-wave"]');

  const duration = audio.duration;
  const current = audio.currentTime;
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = hasDuration ? current / duration : 0;

  shell.classList.toggle('is-playing', !audio.paused && !audio.ended);
  setAudioIconState(playIcon, pauseIcon, audio.paused);
  if (playBtn) playBtn.setAttribute('aria-label', audio.paused ? 'Reproduzir' : 'Pausar');

  bars.forEach((bar, index) => {
    bar.classList.toggle('is-played', (index + 1) / bars.length <= progress);
  });

  if (timeEl) {
    if (!hasDuration) {
      timeEl.textContent = '0:00';
    } else if (!audio.paused) {
      timeEl.textContent = formatAudioTime(Math.max(0, duration - current));
    } else {
      timeEl.textContent = formatAudioTime(duration);
    }
  }

  if (wave) {
    wave.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }
}

function seekAudioFromWave(audio, wave, clientX) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const rect = wave.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
  syncAudioUi(audio);
}

function bindAudioShell(shell) {
  if (!shell || shell.dataset.audioBound) return;
  const audio = shell.querySelector('audio');
  const playBtn = shell.querySelector('[class*="bubble-audio-play"]');
  const wave = shell.querySelector('[class*="bubble-audio-wave"]');
  if (!audio || !playBtn) return;

  shell.dataset.audioBound = '1';

  playBtn.addEventListener('click', () => {
    if (!shell.classList.contains('is-ready')) return;
    if (audio.paused) {
      if (activeAudioElement && activeAudioElement !== audio) {
        activeAudioElement.pause();
        syncAudioUi(activeAudioElement);
      }
      void audio.play().catch(async () => {
        if (audio.dataset.playRetried) {
          shell.classList.add('is-error');
          alert('Não foi possível reproduzir o áudio.');
          return;
        }
        audio.dataset.playRetried = '1';
        delete audio.dataset.hydrated;
        shell.classList.remove('is-ready', 'is-error');
        playBtn.disabled = true;
        await applyMediaToNode(shell);
        if (!shell.classList.contains('is-ready')) {
          shell.classList.add('is-error');
          alert('Não foi possível reproduzir o áudio.');
          return;
        }
        try {
          await audio.play();
          activeAudioElement = audio;
          syncAudioUi(audio);
        } catch {
          shell.classList.add('is-error');
          alert('Não foi possível reproduzir o áudio.');
        }
      });
      activeAudioElement = audio;
    } else {
      audio.pause();
    }
    syncAudioUi(audio);
  });

  wave?.addEventListener('click', (event) => {
    if (!shell.classList.contains('is-ready')) return;
    seekAudioFromWave(audio, wave, event.clientX);
  });

  wave?.addEventListener('keydown', (event) => {
    if (!shell.classList.contains('is-ready')) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const step = audio.duration * 0.05;
    if (event.key === 'ArrowRight') {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
      syncAudioUi(audio);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      audio.currentTime = Math.max(0, audio.currentTime - step);
      syncAudioUi(audio);
      event.preventDefault();
    }
  });

  audio.addEventListener('loadedmetadata', () => syncAudioUi(audio));
  audio.addEventListener('durationchange', () => syncAudioUi(audio));
  audio.addEventListener('timeupdate', () => syncAudioUi(audio));
  audio.addEventListener('ended', () => {
    if (activeAudioElement === audio) activeAudioElement = null;
    syncAudioUi(audio);
  });
  audio.addEventListener('pause', () => syncAudioUi(audio));
  audio.addEventListener('play', () => syncAudioUi(audio));
  audio.addEventListener('error', () => {
    if (!shell.classList.contains('is-ready')) return;
    shell.classList.add('is-error');
    if (playBtn) playBtn.disabled = true;
  });

  if (shell.classList.contains('is-ready')) {
    enableAudioShell(shell, audio);
  } else if (audio.readyState >= 1) {
    enableAudioShell(shell, audio);
  }
}

export function hydrateAudioPlayers(container) {
  if (!container) return;
  container
    .querySelectorAll('.wa-bubble-audio-shell:not([data-audio-bound]), .lw-whatsapp-bubble-audio-shell:not([data-audio-bound])')
    .forEach((shell) => bindAudioShell(shell));
}

function documentDisplayName(m) {
  const texto = String(m?.texto || '').trim();
  if (texto && texto !== '[Documento]') return texto;
  const url = m?.midiaUrl || '';
  if (url) {
    try {
      const segment = url.split('/').pop()?.split('?')[0] || '';
      if (segment) return decodeURIComponent(segment);
    } catch {
      /* ignore */
    }
  }
  if (m?.midiaMimetype) {
    const ext = m.midiaMimetype.split('/').pop();
    if (ext) return `arquivo.${ext}`;
  }
  return 'Documento';
}

function documentExtension(name, mime) {
  const fromName = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
  if (fromName && fromName.length <= 8 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  const mimeMap = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/zip': 'zip',
    'text/plain': 'txt',
  };
  return mimeMap[mime] || 'arquivo';
}

function documentKind(ext) {
  const e = ext.toLowerCase();
  if (e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(e)) return 'word';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(e)) return 'slide';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'archive';
  return 'generic';
}

function documentMetaLabel(ext) {
  const labels = {
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    xls: 'XLS',
    xlsx: 'XLSX',
    ppt: 'PPT',
    pptx: 'PPTX',
    zip: 'ZIP',
    txt: 'TXT',
    csv: 'CSV',
  };
  return labels[ext.toLowerCase()] || ext.toUpperCase() || 'Arquivo';
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const value = unit === 0 ? size : unit === 1 ? Math.round(size) : size.toFixed(1);
  return `${value} ${units[unit]}`;
}

function documentMetaLine(m, ext) {
  const parts = [];
  if (m.midiaPageCount) {
    parts.push(m.midiaPageCount === 1 ? '1 página' : `${m.midiaPageCount} páginas`);
  }
  parts.push(documentMetaLabel(ext));
  const size = formatFileSize(m.midiaFileSize);
  if (size) parts.push(size);
  return parts.join(' · ') || documentMetaLabel(ext);
}

function renderDocumentCard(m, { classPrefix, url, attrs, shell }) {
  const fileName = documentDisplayName(m);
  const ext = documentExtension(fileName, m.midiaMimetype);
  const kind = documentKind(ext);
  const badge = ext.length <= 5 ? ext.toUpperCase() : 'FILE';
  const nameHtml = escapeHtml(fileName);
  const metaLabel = url ? documentMetaLine(m, ext) : `${documentMetaLabel(ext)} · indisponível`;
  const isPdf = kind === 'pdf';
  const previewUrl = m.midiaPreviewUrl
    ? escapeHtml(resolveMediaFetchUrl(m.midiaPreviewUrl))
    : '';
  const cardClass = `${classPrefix}-bubble-doc ${classPrefix}-bubble-doc--${kind}${
    isPdf && url ? ` ${classPrefix}-bubble-doc--has-preview` : ''
  }`;

  const footer = `
    <span class="${classPrefix}-bubble-doc-footer">
      <span class="${classPrefix}-bubble-doc-icon" aria-hidden="true">${escapeHtml(badge)}</span>
      <span class="${classPrefix}-bubble-doc-info">
        <span class="${classPrefix}-bubble-doc-name" title="${nameHtml}">${nameHtml}</span>
        <span class="${classPrefix}-bubble-doc-meta" data-doc-meta>${escapeHtml(metaLabel)}</span>
      </span>
    </span>`;

  let previewBlock = '';
  if (isPdf && url) {
    if (previewUrl) {
      previewBlock = `<span class="${classPrefix}-bubble-doc-preview">
        <img class="${classPrefix}-bubble-doc-preview-img" src="${previewUrl}" alt="" decoding="async" loading="lazy" />
      </span>`;
    } else {
      previewBlock = `<span class="${classPrefix}-bubble-doc-preview">
        <canvas class="${classPrefix}-bubble-doc-preview-canvas"${attrs} aria-hidden="true"></canvas>
      </span>`;
    }
  }

  const body = `${previewBlock}${footer}`;

  if (!url) {
    return `<span class="${cardClass} is-pending"${shell}>${body}</span>`;
  }

  return `<a class="${cardClass}" href="${url}" target="_blank" rel="noopener noreferrer"${attrs}>${body}</a>`;
}

export function shouldShowWhatsappBubbleText(m) {
  if (!m?.texto) return false;
  if (m.tipo === 'audio' || m.tipo === 'sticker') return false;
  if (m.tipo === 'document') {
    const t = String(m.texto).trim();
    const fileName = documentDisplayName(m);
    if (!t || t === '[Documento]' || t === fileName) return false;
    return true;
  }
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
    return renderAudioPlayerHtml(m, { classPrefix, url, attrs, shell });
  }

  if (tipo === 'video' && url) {
    return `<div class="${classPrefix}-bubble-video-shell"${shell}>
      <video class="${classPrefix}-bubble-video"${attrs} controls preload="metadata"></video>
    </div>`;
  }

  if (tipo === 'document') {
    return renderDocumentCard(m, { classPrefix, url, attrs, shell });
  }

  if (!url) {
    return `<span class="${classPrefix}-bubble-media-pending">Mídia indisponível</span>`;
  }

  const label =
    tipo === 'audio'
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
      ? 'Áudio ainda não disponível — aguarde ou reabra a conversa'
      : 'Não foi possível carregar o áudio';
  }
  if (tipo === 'video') {
    return status === 404
      ? 'Vídeo ainda não disponível — aguarde ou reabra a conversa'
      : 'Não foi possível carregar o vídeo';
  }
  if (status === 404) return 'Mídia ainda não disponível — aguarde ou reabra a conversa';
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(resolveMediaFetchUrl(url), {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    const headerType = res.headers.get('content-type');
    if (headerType && (!blob.type || blob.type === 'application/octet-stream')) {
      const normalized = headerType.split(';')[0].trim();
      return new Blob([await blob.arrayBuffer()], { type: normalized });
    }
    return blob;
  } finally {
    clearTimeout(timeout);
  }
}

function sniffAudioMime(bytes) {
  if (!bytes?.length) return '';
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'audio/mp4';
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  return '';
}

function normalizeAudioMime(mimetype) {
  const mime = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') return '';
  if (mime.startsWith('audio/')) return mime;
  return '';
}

async function blobForNode(node, blob) {
  const tipo = mediaTipoFromNode(node);
  if (tipo === 'audio') {
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const sniffed = sniffAudioMime(header);
    const fromBlob = normalizeAudioMime(blob.type);
    const fromMeta = normalizeAudioMime(node.dataset.midiaMimetype);
    const type = sniffed || fromBlob || fromMeta || 'audio/ogg';
    if (!blob.type || blob.type === type) {
      return blob.type === type ? blob : new Blob([blob], { type });
    }
    return new Blob([await blob.arrayBuffer()], { type });
  }

  const preferred = (node.dataset.midiaMimetype || blob.type || '').trim();
  if (!preferred || preferred === blob.type) return blob;
  return new Blob([blob], { type: preferred });
}

function markMediaReady(mediaNode) {
  mediaNode.dataset.hydrated = '1';
  const shell = mediaNode.closest('[class*="bubble-audio-shell"], [class*="bubble-video-shell"]');
  shell?.classList.add('is-ready');
  if (mediaNode.tagName === 'AUDIO') {
    if (shell && !shell.dataset.audioBound) bindAudioShell(shell);
    enableAudioShell(shell, mediaNode);
  }
}

function tryDirectMediaSrc(mediaNode, directUrl) {
  const isAudio = mediaNode.tagName === 'AUDIO';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      mediaNode.removeEventListener('loadedmetadata', onMeta);
      mediaNode.removeEventListener('canplay', onReady);
      mediaNode.removeEventListener('canplaythrough', onReady);
      mediaNode.removeEventListener('error', onError);
      if (ok) markMediaReady(mediaNode);
      resolve(ok);
    };
    const onMeta = () => {
      if (!isAudio) onReady();
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);

    if (isAudio) {
      mediaNode.addEventListener('canplay', onReady);
      mediaNode.addEventListener('canplaythrough', onReady);
    } else {
      mediaNode.addEventListener('loadedmetadata', onMeta);
      mediaNode.addEventListener('canplay', onReady);
    }
    mediaNode.addEventListener('error', onError);
    mediaNode.preload = isAudio ? 'auto' : mediaNode.preload;
    mediaNode.src = directUrl;
    mediaNode.load();
    const timer = setTimeout(() => finish(!isAudio && mediaNode.readyState >= 1), isAudio ? 20000 : 6000);
  });
}

const mediaHydrationLocks = new WeakSet();

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

  if (attempt === 0) {
    if (mediaHydrationLocks.has(mediaNode)) return;
    mediaHydrationLocks.add(mediaNode);
  }

  try {
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

      if (tag === 'AUDIO' && attempt === 0 && (await tryDirectMediaSrc(mediaNode, directUrl))) return;
      if (tag === 'VIDEO' && attempt === 0 && (await tryDirectMediaSrc(mediaNode, directUrl))) return;

      try {
        const blob = await blobForNode(mediaNode, await fetchMediaBlob(url));
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
      const blob = await blobForNode(mediaNode, await fetchMediaBlob(url));
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
  } finally {
    if (attempt === 0) mediaHydrationLocks.delete(mediaNode);
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
    `.${classPrefix}-bubble-doc`,
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
  hydrateAudioPlayers(bubble);
  return true;
}

export async function hydrateWhatsappMedia(container) {
  if (!container) return;

  const candidates = container.querySelectorAll(
    [
      'img[data-midia-url]:not([data-hydrated]):not([data-fallback-shown])',
      '.wa-bubble-audio-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.lw-whatsapp-bubble-audio-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.wa-bubble-video-shell:not(.is-ready):not(:has([data-fallback-shown]))',
      '.lw-whatsapp-bubble-video-shell:not(.is-ready):not(:has([data-fallback-shown]))',
    ].join(', '),
  );

  const seen = new Set();
  const nodes = [];
  for (const node of candidates) {
    const mediaNode = node.matches('audio,video,img')
      ? node
      : node.querySelector('audio,video,img');
    const key = cacheKeyForNode(mediaNode || node);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }

  await Promise.all(nodes.map((node) => applyMediaToNode(node)));
  await hydrateDocumentPreviews(container);
  hydrateAudioPlayers(container);
  await hydrateLinkPreviews(container);
}

let pdfjsModule = null;

async function getPdfJs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist/build/pdf.mjs');
    pdfjsModule.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }
  return pdfjsModule;
}

async function renderPdfPreviewCanvas(canvas) {
  if (!canvas || canvas.dataset.rendered) return;
  const url = canvas.dataset.midiaUrl;
  if (!url) return;

  try {
    const pdfjs = await getPdfJs();
    const blob = await fetchMediaBlob(url);
    const data = await blob.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = 280;
    const maxHeight = 200;
    const scale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height, 2);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    canvas.dataset.rendered = '1';
    canvas.closest('[class*="-bubble-doc"]')?.classList.add('is-preview-ready');

    const metaEl = canvas.closest('[class*="-bubble-doc"]')?.querySelector('[data-doc-meta]');
    if (metaEl) {
      const parts = [];
      if (pdf.numPages) {
        parts.push(pdf.numPages === 1 ? '1 página' : `${pdf.numPages} páginas`);
      }
      const current = metaEl.textContent.trim();
      const typePart = current.split('·').map((part) => part.trim()).find((part) => /^[A-Z0-9]{2,5}$/.test(part));
      if (typePart) parts.push(typePart);
      if (blob.size) {
        const size = formatFileSize(blob.size);
        if (size) parts.push(size);
      }
      if (parts.length) metaEl.textContent = parts.join(' · ');
    }
  } catch {
    canvas.closest('[class*="-bubble-doc-preview"]')?.classList.add('is-preview-failed');
  }
}

export async function hydrateDocumentPreviews(container) {
  if (!container) return;
  const canvases = container.querySelectorAll(
    '.wa-bubble-doc-preview-canvas:not([data-rendered]), .lw-whatsapp-bubble-doc-preview-canvas:not([data-rendered])',
  );
  await Promise.all([...canvases].map((canvas) => renderPdfPreviewCanvas(canvas)));
}

const mediaRetryTimers = new WeakMap();

export function retryPendingWhatsappMedia(container, { delays = [800, 2000, 5000, 12000, 25000, 45000] } = {}) {
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
