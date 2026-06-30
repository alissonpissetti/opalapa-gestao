const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 256 * 1024;

const cache = new Map();

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function titleFromHtml(html) {
  const og = metaContent(html, 'og:title');
  if (og) return og;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}

function resolveAbsoluteUrl(baseUrl, value) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^127\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host === '::1')) return true;
  return false;
}

export function normalizePreviewUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let candidate = raw.replace(/[),.!?]+$/, '');
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (isPrivateHost(parsed.hostname)) return null;
  return parsed.href;
}

function instagramPreview(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'instagram.com') return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) {
      return { title: 'Instagram', siteName: 'instagram.com', description: url, image: null };
    }

    const kind = parts[0].toLowerCase();
    if (['p', 'reel', 'reels', 'tv', 'stories'].includes(kind)) {
      return {
        title: 'Publicação no Instagram',
        siteName: 'instagram.com',
        description: url,
        image: null,
      };
    }

    const handle = parts[0].replace(/^@/, '');
    return {
      title: `@${handle}`,
      siteName: 'Instagram',
      description: 'Perfil no Instagram',
      image: null,
    };
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});

    const buffer = Buffer.concat(chunks);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLinkPreview(inputUrl) {
  const url = normalizePreviewUrl(inputUrl);
  if (!url) {
    throw Object.assign(new Error('URL inválida para prévia'), { status: 400 });
  }

  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const instagram = instagramPreview(url);
  if (instagram) {
    const data = { url, ...instagram };
    cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  const html = await fetchHtml(url);
  const title =
    metaContent(html || '', 'og:title') ||
    metaContent(html || '', 'twitter:title') ||
    titleFromHtml(html || '') ||
    new URL(url).hostname.replace(/^www\./, '');
  const description =
    metaContent(html || '', 'og:description') ||
    metaContent(html || '', 'twitter:description') ||
    metaContent(html || '', 'description') ||
    '';
  const image =
    resolveAbsoluteUrl(url, metaContent(html || '', 'og:image')) ||
    resolveAbsoluteUrl(url, metaContent(html || '', 'twitter:image')) ||
    null;
  const siteName =
    metaContent(html || '', 'og:site_name') || new URL(url).hostname.replace(/^www\./, '');

  const data = {
    url,
    title: title || siteName,
    description: description || '',
    image,
    siteName,
  };

  cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
