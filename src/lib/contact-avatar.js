const API_BASE = import.meta.env.VITE_API_URL || '';

/** Mantém a última URL autenticada por participante para evitar piscar ao atualizar a lista. */
const avatarSrcByParticipante = new Map();

export function resolveApiAssetUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

/** URL do avatar com token (necessário: <img> não envia X-Evento-Id). */
export function avatarImgSrc(contact) {
  const participanteId = Number(contact?.participanteId || contact?.id);
  const fromApi = contact?.avatarUrl ? resolveApiAssetUrl(contact.avatarUrl) : '';

  if (fromApi && participanteId > 0) {
    const prev = avatarSrcByParticipante.get(participanteId);
    const samePath = prev && prev.split('?')[0] === fromApi.split('?')[0];
    if (samePath && prev) return prev;
    avatarSrcByParticipante.set(participanteId, fromApi);
    return fromApi;
  }

  if (participanteId > 0 && avatarSrcByParticipante.has(participanteId)) {
    return avatarSrcByParticipante.get(participanteId);
  }

  return fromApi;
}

export function participantInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export function mountContactAvatar(el, contact, className = 'wa-chat-avatar') {
  if (!el) return;
  const participanteId = Number(contact?.participanteId || contact?.id);
  const initial = participantInitial(contact?.participanteNome || contact?.nome);
  const hasPhoto = Boolean(contact?.avatarUrl);

  if (
    participanteId > 0 &&
    el.dataset.participanteId === String(participanteId) &&
    el.classList.contains(`${className}--photo`) === hasPhoto &&
    (!hasPhoto || el.querySelector('img'))
  ) {
    return;
  }

  if (participanteId > 0) {
    el.dataset.participanteId = String(participanteId);
  } else {
    delete el.dataset.participanteId;
  }

  el.className = className;
  el.dataset.initial = initial;
  el.replaceChildren();

  if (!hasPhoto) {
    el.textContent = initial;
    return;
  }

  el.classList.add(`${className}--photo`);
  const img = document.createElement('img');
  img.src = avatarImgSrc(contact);
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener(
    'error',
    () => {
      if (participanteId > 0) avatarSrcByParticipante.delete(participanteId);
      el.className = className;
      el.textContent = initial;
      delete el.dataset.participanteId;
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
