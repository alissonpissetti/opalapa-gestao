import { escapeHtml, formatPhoneDisplay } from './format.js';

export function renderWhatsappPhoneButton({
  participanteId,
  phone,
  display,
  className = 'tbtn linkish wa-phone-btn',
} = {}) {
  const id = Number(participanteId);
  const hasPhone = Boolean(String(phone || '').trim());
  const label = display || formatPhoneDisplay(phone);
  if (!label) return '';
  if (!Number.isInteger(id) || id < 1 || !hasPhone) {
    return escapeHtml(label);
  }
  return `<button type="button" class="${className}" data-action="open-whatsapp-chat" data-participante-id="${id}">${escapeHtml(label)}</button>`;
}

export function bindWhatsappChatButtons(root, onOpenWhatsappChat, { beforeOpen } = {}) {
  if (!root || typeof onOpenWhatsappChat !== 'function') return;
  root.querySelectorAll('[data-action="open-whatsapp-chat"][data-participante-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const participanteId = Number(btn.dataset.participanteId);
      if (!Number.isInteger(participanteId) || participanteId < 1) return;
      beforeOpen?.(participanteId, btn);
      onOpenWhatsappChat(participanteId);
    });
  });
}
