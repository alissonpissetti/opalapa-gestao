import { escapeHtml } from './format.js';

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function extractFirstHttpUrl(text) {
  const match = String(text || '').match(URL_RE);
  return match?.[0]?.replace(/[),.!?]+$/, '') || null;
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

function linkifyText(text, classPrefix) {
  const raw = String(text || '');
  if (!raw) return '';
  const parts = raw.split(URL_RE);
  const urls = raw.match(URL_RE) || [];
  if (!urls.length) return escapeHtml(raw);

  let html = '';
  parts.forEach((part, index) => {
    html += escapeHtml(part);
    const url = urls[index];
    if (!url) return;
    const clean = url.replace(/[),.!?]+$/, '');
    const trailing = url.slice(clean.length);
    html += `<a class="${classPrefix}-bubble-link" href="${escapeHtml(clean)}" target="_blank" rel="noopener noreferrer">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`;
  });
  return html;
}

function previewSiteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
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
      <span class="${classPrefix}-bubble-link-preview-site">${escapeHtml(site)}</span>
    </span>
  </a>`;
}

function renderGenericPreviewCard(url, classPrefix) {
  const site = previewSiteLabel(url);
  return `<a class="${classPrefix}-bubble-link-preview" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-link-preview-url="${escapeHtml(url)}">
    <span class="${classPrefix}-bubble-link-preview-body ${classPrefix}-bubble-link-preview-body--solo">
      <span class="${classPrefix}-bubble-link-preview-title" data-preview-title>${escapeHtml(site)}</span>
      <span class="${classPrefix}-bubble-link-preview-site">${escapeHtml(url)}</span>
    </span>
  </a>`;
}

export function renderWhatsappBubbleTextHtml(m, { classPrefix = 'wa' } = {}) {
  const text = String(m?.texto || '').trim();
  if (!text) return '';

  const url = extractFirstHttpUrl(text);
  const youtubeId = url ? extractYoutubeVideoId(url) : null;
  const preview = youtubeId
    ? renderYoutubePreviewCard(url, youtubeId, classPrefix)
    : url
      ? renderGenericPreviewCard(url, classPrefix)
      : '';

  const hidePlainUrl = Boolean(preview && text === url);
  const textHtml = hidePlainUrl ? '' : `<p class="${classPrefix}-bubble-text">${linkifyText(text, classPrefix)}</p>`;

  return `${textHtml}${preview}`;
}

export function bubbleModifierClasses(m, { classPrefix = 'wa' } = {}) {
  const base = classPrefix === 'lw-whatsapp' ? 'lw-whatsapp-bubble' : 'wa-bubble';
  const classes = [];
  if (m?.tipo === 'audio') classes.push(`${base}--audio-only`);
  const text = String(m?.texto || '').trim();
  if (text && extractFirstHttpUrl(text)) classes.push(`${base}--has-link-preview`);
  return classes.join(' ');
}

export async function hydrateLinkPreviews(container) {
  if (!container) return;

  const youtubeCards = container.querySelectorAll('[data-youtube-url]:not([data-preview-loaded])');
  await Promise.all(
    [...youtubeCards].map(async (card) => {
      const url = card.dataset.youtubeUrl;
      const titleEl = card.querySelector('[data-preview-title]');
      card.dataset.previewLoaded = '1';
      if (!url || !titleEl) return;
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data?.title) titleEl.textContent = data.title;
      } catch {
        /* mantém fallback */
      }
    }),
  );
}
