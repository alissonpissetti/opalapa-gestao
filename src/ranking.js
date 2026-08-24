const REFRESH_MS = 30_000;

const listEl = document.getElementById('ranking-list');
const eventoEl = document.getElementById('ranking-evento');
const updatedEl = document.getElementById('ranking-updated');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatUpdatedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function buildApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const eventoId = params.get('eventoId');
  const url = new URL('/api/stock-experience/ranking', window.location.origin);
  if (eventoId) url.searchParams.set('eventoId', eventoId);
  return url.toString();
}

function renderRanking(data) {
  const { eventoNome, eventoEdicao, items, updatedAt } = data;

  const eventoLabel = eventoNome
    ? `${eventoNome}${eventoEdicao ? ` · ${eventoEdicao}ª edição` : ''}`
    : 'Classificação geral';
  eventoEl.textContent = eventoLabel;

  const latestUpdate =
    items.reduce((max, item) => {
      const ts = item.updatedAt ? Date.parse(item.updatedAt) : 0;
      return ts > max ? ts : max;
    }, 0) || (updatedAt ? Date.parse(updatedAt) : 0);

  const timeLabel = formatUpdatedAt(latestUpdate ? new Date(latestUpdate).toISOString() : null);
  updatedEl.textContent = timeLabel ? `Atualizado às ${timeLabel}` : '';

  if (!items.length) {
    listEl.innerHTML = '<li class="ranking-empty">Nenhum piloto no ranking ainda.</li>';
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const posClass =
        item.posicao === 1 ? 'ranking-item--p1' : item.posicao === 2 ? 'ranking-item--p2' : item.posicao === 3 ? 'ranking-item--p3' : '';
      const veiculo = item.veiculo ? escapeHtml(item.veiculo) : 'Chevrolet Opala';
      const tempo = item.tempo ? `<span class="ranking-tempo">${escapeHtml(item.tempo)}</span>` : '';

      return `
        <li class="ranking-item ${posClass}">
          <span class="ranking-pos">${item.posicao}º</span>
          <span class="ranking-name">${escapeHtml(item.nome)}</span>
          <span class="ranking-veiculo">${veiculo}</span>
          <div class="ranking-stats">
            <span class="ranking-pontos">${item.pontos}</span>
            <span class="ranking-pontos-label">pts</span>
            ${tempo}
          </div>
        </li>
      `;
    })
    .join('');
}

function renderError(message) {
  eventoEl.textContent = 'Opalapa Stock Experience';
  listEl.innerHTML = `<li class="ranking-error">${escapeHtml(message)}</li>`;
  updatedEl.textContent = '';
}

async function loadRanking() {
  try {
    const res = await fetch(buildApiUrl(), { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro ${res.status}`);
    }
    const data = await res.json();
    renderRanking(data);
  } catch (err) {
    renderError(err.message || 'Falha ao carregar o ranking');
  }
}

loadRanking();
setInterval(loadRanking, REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadRanking();
});
