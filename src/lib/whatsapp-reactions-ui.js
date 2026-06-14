import { QUICK_REACTIONS } from './whatsapp-reactions.js';

let activePicker = null;

function closeReactionPicker() {
  activePicker?.remove();
  activePicker = null;
  document.removeEventListener('click', onPickerOutside, true);
  document.removeEventListener('keydown', onPickerEscape, true);
}

function onPickerOutside(e) {
  if (activePicker?.contains(e.target)) return;
  if (e.target.closest('.wa-msg-react-btn')) return;
  closeReactionPicker();
}

function onPickerEscape(e) {
  if (e.key === 'Escape') closeReactionPicker();
}

function openReactionPicker(anchor, { onSelect }) {
  closeReactionPicker();

  const picker = document.createElement('div');
  picker.className = 'wa-reaction-picker';
  picker.setAttribute('role', 'menu');
  picker.innerHTML = QUICK_REACTIONS.map(
    (emoji) =>
      `<button type="button" class="wa-reaction-picker-btn" data-emoji="${emoji}" role="menuitem" aria-label="Reagir com ${emoji}">${emoji}</button>`,
  ).join('');

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.wa-reaction-picker-btn');
    if (!btn) return;
    e.stopPropagation();
    onSelect(btn.dataset.emoji || '');
    closeReactionPicker();
  });

  document.body.appendChild(picker);
  activePicker = picker;

  const rect = anchor.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  let top = rect.top - pickerRect.height - 8;
  let left = rect.left + rect.width / 2 - pickerRect.width / 2;

  if (top < 8) top = rect.bottom + 8;
  if (left < 8) left = 8;
  if (left + pickerRect.width > window.innerWidth - 8) {
    left = window.innerWidth - pickerRect.width - 8;
  }

  picker.style.top = `${top}px`;
  picker.style.left = `${left}px`;

  requestAnimationFrame(() => {
    document.addEventListener('click', onPickerOutside, true);
    document.addEventListener('keydown', onPickerEscape, true);
  });
}

export function bindWhatsappReactionControls(container, { onReact, disabled = false } = {}) {
  if (!container || typeof onReact !== 'function') return () => {};

  const handleClick = async (e) => {
    if (disabled) return;

    const reactBtn = e.target.closest('.wa-msg-react-btn');
    if (reactBtn) {
      e.stopPropagation();
      const msgId = Number(reactBtn.dataset.msgId);
      if (!msgId) return;
      openReactionPicker(reactBtn, {
        onSelect: (emoji) => onReact(msgId, emoji),
      });
      return;
    }

    const chip = e.target.closest('.wa-reaction-chip');
    if (chip) {
      e.stopPropagation();
      const msgId = Number(chip.dataset.msgId || chip.closest('[data-msg-id]')?.dataset.msgId);
      const emoji = chip.dataset.emoji || '';
      if (!msgId || !emoji) return;
      chip.disabled = true;
      try {
        await onReact(msgId, emoji);
      } finally {
        chip.disabled = false;
      }
    }
  };

  container.addEventListener('click', handleClick);

  return () => {
    container.removeEventListener('click', handleClick);
    closeReactionPicker();
  };
}
