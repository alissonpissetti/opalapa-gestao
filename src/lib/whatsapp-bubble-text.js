import { escapeHtml } from './format.js';
import { fetchLinkPreview } from './api.js';

const HTTP_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const BARE_URL_RE =
  /(?:^|\s)((?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"',]*)?)/i;

function cleanUrlTail(value) {
  return String(value || '').replace(/[),.!?]+$/, '');
}

export function normalizeMessageUrl(value) {
  let clean = cleanUrlTail(String(value || '').trim());
  if (!clean) return null;
  if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
  try {
    const parsed = new URL(clean);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function extractFirstUrl(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const httpMatch = raw.match(HTTP_URL_RE);
  if (httpMatch?.[0]) return normalizeMessageUrl(httpMatch[0]);

  const bareMatch = raw.match(BARE_URL_RE);
  if (bareMatch?.[1]) return normalizeMessageUrl(bareMatch[1]);

  return null;
}

/** @deprecated use extractFirstUrl */
export function extractFirstHttpUrl(text) {
  return extractFirstUrl(text);
}

export function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname.startsWith('/watch')) return parsed.searchParams.get('v');
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || null;
    }
  } catch {
    return null;
  }
  return null;
}

function splitTextWithUrls(text) {
  const raw = String(text || '');
  if (!raw) return [];

  const tokens = [];
  const pushText = (value) => {
    if (value) tokens.push({ type: 'text', value });
  };

  let cursor = 0;
  while (cursor < raw.length) {
    const slice = raw.slice(cursor);
    const httpMatch = slice.match(HTTP_URL_RE);
    const bareMatch = slice.match(BARE_URL_RE);

    let nextIndex = -1;
    let urlRaw = null;

    if (httpMatch?.index === 0) {
      urlRaw = httpMatch[0];
      nextIndex = cursor;
    } else if (bareMatch) {
      const bareIndex = bareMatch.index + (bareMatch[0].length - bareMatch[1].length);
      if (bareIndex >= 0 && (nextIndex < 0 || bareIndex < nextIndex)) {
        urlRaw = bareMatch[1];
        nextIndex = cursor + bareIndex;
      }
    }

    if (nextIndex < 0 || !urlRaw) {
      pushText(raw.slice(cursor));
      break;
    }

    if (nextIndex > cursor) {
      pushText(raw.slice(cursor, nextIndex));
    }

    const normalized = normalizeMessageUrl(urlRaw);
    if (normalized) {
      tokens.push({ type: 'url', value: urlRaw, href: normalized });
      cursor = nextIndex + urlRaw.length;
    } else {
      pushText(urlRaw);
      cursor = nextIndex + urlRaw.length;
    }
  }

  return tokens;
}

function linkifyText(text, classPrefix) {
  const tokens = splitTextWithUrls(text);
  if (!tokens.length) return escapeHtml(text);
  if (tokens.length === 1 && tokens[0].type === 'text') return escapeHtml(tokens[0].value);

  return tokens
    .map((token) => {
      if (token.type === 'text') return escapeHtml(token.value);
      return `<a class="${classPrefix}-bubble-link" href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.value)}</a>`;
    })
    .join('');
}

function previewSiteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

function messageTextIsOnlyUrl(text, url) {
  const raw = String(text || '').trim();
  if (!raw || !url) return false;
  if (raw === url) return true;

  const normalized = normalizeMessageUrl(raw);
  if (normalized === url) return true;

  try {
    const parsed = new URL(url);
    const withoutProtocol = raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '');
    const target = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}${parsed.search}`
      .replace(/\/$/, '')
      .replace(/^www\./i, '');
    return withoutProtocol === target;
  } catch {
    return false;
  }
}

function renderYoutubePreviewCard(url, videoId, classPrefix) {
  const thumb = `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const site = previewSiteLabel(url);
  return `<a class="${classPrefix}-bubble-link-preview ${classPrefix}-bubble-link-preview--youtube" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-youtube-url="${escapeHtml(url)}">
    <span class="${classPrefix}-bubble-link-preview-thumb">
      <img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" />
      <span class="${classPrefix}-bubble-link-preview-play" aria-hidden="true"></span>
    </span>
    <span class="${classPrefix}-bubble-link-preview-body">
      <span class="${classPrefix}-bubble-link-preview-title" data-preview-title>YouTube</span>
      <span class="${classPrefix}-bubble-link-preview-site" data-preview-site>${escapeHtml(site)}</span>
    </span>
  </a>`;
}

function renderRichPreviewCard(url, classPrefix) {
  const site = previewSiteLabel(url);
  return `<a class="${classPrefix}-bubble-link-preview" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-link-preview-url="${escapeHtml(url)}">
    <span class="${classPrefix}-bubble-link-preview-thumb" data-preview-thumb hidden></span>
    <span class="${classPrefix}-bubble-link-preview-body">
      <span class="${classPrefix}-bubble-link-preview-title" data-preview-title>${escapeHtml(site)}</span>
      <span class="${classPrefix}-bubble-link-preview-desc" data-preview-desc hidden></span>
      <span class="${classPrefix}-bubble-link-preview-site" data-preview-site>${escapeHtml(site)}</span>
    </span>
  </a>`;
}

export function renderWhatsappBubbleTextHtml(m, { classPrefix = 'wa' } = {}) {
  const text = String(m?.texto || '').trim();
  if (!text) return '';

  const url = extractFirstUrl(text);
  const youtubeId = url ? extractYoutubeVideoId(url) : null;
  const preview = youtubeId
    ? renderYoutubePreviewCard(url, youtubeId, classPrefix)
    : url
      ? renderRichPreviewCard(url, classPrefix)
      : '';

  const hidePlainUrl = Boolean(preview && messageTextIsOnlyUrl(text, url));
  const textHtml = hidePlainUrl ? '' : `<p class="${classPrefix}-bubble-text">${linkifyText(text, classPrefix)}</p>`;

  return `${textHtml}${preview}`;
}

export function bubbleModifierClasses(m, { classPrefix = 'wa' } = {}) {
  const base = classPrefix === 'lw-whatsapp' ? 'lw-whatsapp-bubble' : 'wa-bubble';
  const classes = [];
  if (m?.tipo === 'audio') classes.push(`${base}--audio-only`);
  const text = String(m?.texto || '').trim();
  if (text && extractFirstUrl(text)) classes.push(`${base}--has-link-preview`);
  return classes.join(' ');
}

function applyPreviewData(card, data) {
  const titleEl = card.querySelector('[data-preview-title]');
  const descEl = card.querySelector('[data-preview-desc]');
  const siteEl = card.querySelector('[data-preview-site]');
  const thumbEl = card.querySelector('[data-preview-thumb]');

  if (titleEl && data?.title) titleEl.textContent = data.title;
  if (siteEl && data?.siteName) siteEl.textContent = data.siteName;
  if (descEl && data?.description) {
    descEl.textContent = data.description;
    descEl.hidden = false;
  }

  if (thumbEl && data?.image) {
    const img = document.createElement('img');
    img.src = data.image;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      thumbEl.hidden = true;
      thumbEl.innerHTML = '';
    });
    thumbEl.innerHTML = '';
    thumbEl.appendChild(img);
    thumbEl.hidden = false;
  }
}

export async function hydrateLinkPreviews(container) {
  if (!container) return;

  const youtubeCards = container.querySelectorAll('[data-youtube-url]:not([data-preview-loaded])');
  await Promise.all(
    [...youtubeCards].map(async (card) => {
      const url = card.dataset.youtubeUrl;
      card.dataset.previewLoaded = '1';
      if (!url) return;
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        );
        if (!res.ok) return;
        const data = await res.json();
        applyPreviewData(card, {
          title: data?.title || 'YouTube',
          siteName: previewSiteLabel(url),
        });
      } catch {
        /* mantém fallback */
      }
    }),
  );

  const genericCards = container.querySelectorAll('[data-link-preview-url]:not([data-preview-loaded])');
  await Promise.all(
    [...genericCards].map(async (card) => {
      const url = card.dataset.linkPreviewUrl;
      card.dataset.previewLoaded = '1';
      if (!url) return;
      try {
        const data = await fetchLinkPreview(url);
        applyPreviewData(card, data);
      } catch {
        /* mantém fallback local */
      }
    }),
  );
}
