import { escapeHtml } from './format.js';

const blobUrls = new WeakMap();

function mediaAttrs(m) {
  if (!m?.midiaUrl || !m?.id) return '';
  return ` data-midia-id="${m.id}" data-midia-url="${escapeHtml(m.midiaUrl)}"`;
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
  const url = m.midiaUrl ? escapeHtml(m.midiaUrl) : '';
  const tipo = m.tipo;

  if (tipo === 'image' || tipo === 'sticker') {
    if (url) {
      const stickerClass = tipo === 'sticker' ? ` ${classPrefix}-bubble-sticker` : '';
      return `<img class="${classPrefix}-bubble-img${stickerClass}"${attrs} src="${url}" alt="" loading="lazy" decoding="async" />`;
    }
    return `<span class="${classPrefix}-bubble-media-pending">Imagem indisponível</span>`;
  }

  if (tipo === 'audio' && url) {
    return `<audio class="${classPrefix}-bubble-audio"${attrs} src="${url}" controls preload="metadata"></audio>`;
  }

  if (tipo === 'video' && url) {
    return `<video class="${classPrefix}-bubble-video"${attrs} src="${url}" controls preload="metadata"></video>`;
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

function showWhatsappMediaPending(node, message = 'Mídia expirada ou indisponível') {
  if (!node?.isConnected || node.dataset.fallbackShown) return;
  const wrapper =
    node.closest('.wa-bubble') ||
    node.closest('.lw-whatsapp-bubble') ||
    node.parentElement;
  if (!wrapper || wrapper.querySelector('.wa-bubble-media-pending')) return;

  node.dataset.fallbackShown = '1';
  const pending = document.createElement('span');
  pending.className = 'wa-bubble-media-pending';
  pending.textContent = message;
  node.replaceWith(pending);
}

function isSameOriginMediaUrl(url) {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function bindWhatsappMediaErrors(container) {
  if (!container) return;

  const nodes = container.querySelectorAll(
    'img[data-midia-url], video[data-midia-url], audio[data-midia-url]',
  );

  for (const node of nodes) {
    if (node.dataset.errorBound) continue;
    node.dataset.errorBound = '1';
    node.addEventListener('error', () => {
      showWhatsappMediaPending(node);
    });
  }
}

export async function hydrateWhatsappMedia(container) {
  if (!container) return;

  bindWhatsappMediaErrors(container);

  const nodes = container.querySelectorAll(
    'img[data-midia-url]:not([data-hydrated]), video[data-midia-url]:not([data-hydrated]), audio[data-midia-url]:not([data-hydrated])',
  );

  await Promise.all(
    [...nodes].map(async (node) => {
      const url = node.dataset.midiaUrl;
      if (!url) return;

      if (isSameOriginMediaUrl(url)) {
        node.dataset.hydrated = '1';
        return;
      }

      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          showWhatsappMediaPending(
            node,
            res.status === 404 ? 'Mídia expirada ou indisponível' : 'Não foi possível carregar a mídia',
          );
          return;
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const prev = blobUrls.get(node);
        if (prev) URL.revokeObjectURL(prev);
        blobUrls.set(node, objectUrl);
        node.src = objectUrl;
        node.dataset.hydrated = '1';
      } catch {
        showWhatsappMediaPending(node, 'Não foi possível carregar a mídia');
      }
    }),
  );
}
