import { escapeHtml } from './format.js';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function renderWhatsappReactions(reacoes, className = 'wa-bubble-reactions', { msgId } = {}) {
  if (!Array.isArray(reacoes) || !reacoes.length) return '';

  const grouped = new Map();
  for (const reaction of reacoes) {
    const emoji = String(reaction.emoji || '').trim();
    if (!emoji) continue;
    const entry = grouped.get(emoji) || { emoji, count: 0, mine: false };
    entry.count += 1;
    if (reaction.fromMe) entry.mine = true;
    grouped.set(emoji, entry);
  }

  if (!grouped.size) return '';

  const msgAttr = msgId ? ` data-msg-id="${msgId}"` : '';
  const chips = [...grouped.values()]
    .map((group) => {
      const count =
        group.count > 1 ? `<span class="wa-reaction-count">${group.count}</span>` : '';
      const mineClass = group.mine ? ' wa-reaction-chip--mine' : '';
      return `<button type="button" class="wa-reaction-chip${mineClass}" data-emoji="${escapeHtml(group.emoji)}"${msgAttr} aria-label="Reação ${escapeHtml(group.emoji)}">${escapeHtml(group.emoji)}${count}</button>`;
    })
    .join('');

  return `<div class="${className}" aria-label="Reações"${msgAttr}>${chips}</div>`;
}

function renderBubbleActions(msgId, actionsClass = 'wa-msg-actions') {
  if (!msgId) return '';
  return `<div class="${actionsClass}" data-msg-id="${msgId}">
    <button type="button" class="wa-msg-react-btn" data-msg-id="${msgId}" aria-label="Reagir" title="Reagir">
      <span aria-hidden="true">🙂</span>
    </button>
  </div>`;
}

export function wrapWhatsappBubble(
  bubbleHtml,
  { out, reacoes, wrapClass, reactionsClass, actionsClass, msgId },
) {
  const reactionsHtml = renderWhatsappReactions(reacoes, reactionsClass, { msgId });
  const align = out ? `${wrapClass}--out` : `${wrapClass}--in`;
  const idAttr = msgId ? ` data-msg-id="${msgId}"` : '';
  const actionsHtml = renderBubbleActions(msgId, actionsClass || 'wa-msg-actions');

  return `<div class="${wrapClass} ${align}${reactionsHtml ? ` ${wrapClass}--has-reactions` : ''}"${idAttr}>
    <div class="wa-bubble-row">
      ${actionsHtml}
      ${bubbleHtml}
    </div>
    ${reactionsHtml}
  </div>`;
}
