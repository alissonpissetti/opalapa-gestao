const API_BASE = import.meta.env.VITE_API_URL || '';

export function resolveApiAssetUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

export function participantInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export function mountContactAvatar(el, contact, className = 'wa-chat-avatar') {
  if (!el) return;
  const initial = participantInitial(contact?.participanteNome || contact?.nome);
  el.className = className;
  el.dataset.initial = initial;
  el.replaceChildren();
  if (!contact?.avatarUrl) {
    el.textContent = initial;
    return;
  }
  el.classList.add(`${className}--photo`);
  const img = document.createElement('img');
  img.src = resolveApiAssetUrl(contact.avatarUrl);
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener(
    'error',
    () => {
      el.className = className;
      el.textContent = initial;
    },
    { once: true },
  );
  el.appendChild(img);
}

export function bindContactAvatarImages(container, className = 'wa-thread-avatar') {
  if (!container) return;
  const chatClass = className === 'wa-chat-avatar' ? 'wa-chat-avatar' : 'wa-thread-avatar';
  container.querySelectorAll(`.${className}--photo img, .${chatClass}--photo img`).forEach((img) => {
    img.addEventListener(
      'error',
      () => {
        const wrap = img.closest(`.${className}, .${chatClass}`);
        if (!wrap) return;
        wrap.className = wrap.classList.contains('wa-chat-avatar') ? 'wa-chat-avatar' : className;
        wrap.textContent = wrap.dataset.initial || '?';
      },
      { once: true },
    );
  });
}
