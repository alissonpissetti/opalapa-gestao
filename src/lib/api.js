import { getActiveEventoId } from './evento.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

let onUnauthorized = null;

function eventoHeaders() {
  const id = getActiveEventoId();
  return id ? { 'X-Evento-Id': String(id) } : {};
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    const { timeoutMs: _ignored, ...fetchOptions } = options;
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...eventoHeaders(), ...options.headers },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(
        'A requisição demorou demais. Verifique se a API e o banco de dados estão acessíveis.',
        0,
      );
    }
    throw new ApiError(
      'Não foi possível conectar à API. Rode "npm run dev" para subir API e frontend juntos.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch (_) {
      if (res.status === 413) {
        message = 'Arquivo muito grande. O limite é 16 MB.';
      }
    }
    if (res.status === 401 && onUnauthorized && !path.includes('/auth/login')) {
      onUnauthorized();
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return null;
  return res.json();
}

export function fetchGrupos() {
  return apiRequest('/api/grupos');
}

export function fetchGrupoSpaces(slug) {
  return apiRequest(`/api/grupos/${encodeURIComponent(slug)}/espacos`);
}

export function saveGrupoSpaces(slug, updates) {
  return apiRequest(`/api/grupos/${encodeURIComponent(slug)}/espacos`, {
    method: 'PUT',
    body: JSON.stringify({ updates }),
  });
}

export function fetchEspacosDisponiveis() {
  return apiRequest('/api/espacos-disponiveis');
}

export function moveEspacosReserva(slug, data) {
  return apiRequest(`/api/grupos/${encodeURIComponent(slug)}/espacos/mover-grupo`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function moveEspacoReserva(slug, origemNumero, data) {
  return apiRequest(
    `/api/grupos/${encodeURIComponent(slug)}/espacos/${encodeURIComponent(origemNumero)}/mover`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

export function fetchTiposComercio() {
  return apiRequest('/api/tipos-comercio');
}

export function fetchUsers() {
  return apiRequest('/api/users');
}

export function createUser(data) {
  return apiRequest('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateUser(id, data) {
  return apiRequest(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteUser(id) {
  return apiRequest(`/api/users/${id}`, { method: 'DELETE' });
}

export function fetchPermissionCatalog() {
  return apiRequest('/api/permission-groups/catalog');
}

export function fetchPermissionGroups() {
  return apiRequest('/api/permission-groups');
}

export function createPermissionGroup(data) {
  return apiRequest('/api/permission-groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePermissionGroup(id, data) {
  return apiRequest(`/api/permission-groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deletePermissionGroup(id) {
  return apiRequest(`/api/permission-groups/${id}`, { method: 'DELETE' });
}

export function fetchParticipantes() {
  return apiRequest('/api/participantes');
}

export function createParticipante(data) {
  return apiRequest('/api/participantes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateParticipante(id, data) {
  return apiRequest(`/api/participantes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function fetchSeguidoresHistorico(participanteId) {
  return apiRequest(`/api/participantes/${participanteId}/seguidores-historico`);
}

export function deleteParticipante(id) {
  return apiRequest(`/api/participantes/${id}`, { method: 'DELETE' });
}

export function fetchArrecadacao({ scope = 'comercial' } = {}) {
  return apiRequest(`/api/arrecadacao?scope=${encodeURIComponent(scope)}`);
}

export function fetchArrecadacaoById(id) {
  return apiRequest(`/api/arrecadacao/${id}`);
}

export function fetchArrecadacaoByEspacoId(espacoId) {
  return apiRequest(`/api/arrecadacao/by-espaco/${espacoId}`);
}

export function createPatrocinio(data) {
  return apiRequest('/api/arrecadacao', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function createArtisticoLead(data) {
  return apiRequest('/api/arrecadacao', {
    method: 'POST',
    body: JSON.stringify({ ...data, tipo: 'artistico' }),
  });
}

export function updateArrecadacao(id, data) {
  return apiRequest(`/api/arrecadacao/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function migrateArrecadacaoToArtistico(id) {
  try {
    return await apiRequest(`/api/arrecadacao/${id}/migrar-artistico`, { method: 'POST' });
  } catch (err) {
    if (err.status === 404) {
      return updateArrecadacao(id, { tipo: 'artistico' });
    }
    throw err;
  }
}

export function deleteArrecadacao(id) {
  return apiRequest(`/api/arrecadacao/${id}`, { method: 'DELETE' });
}

export function registerPerdaLead(id, data) {
  return apiRequest(`/api/arrecadacao/${id}/perda-lead`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchPagamentosArrecadacao(arrecadacaoId) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/pagamentos`);
}

export function fetchPagamentosParticipante(participanteId) {
  return apiRequest(`/api/participantes/${participanteId}/pagamentos`);
}

export function registerPagamento(arrecadacaoId, data) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/pagamentos`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchTarefasContato({ status = 'pendentes' } = {}) {
  const q = status && status !== 'pendentes' ? `?status=${encodeURIComponent(status)}` : '';
  return apiRequest(`/api/tarefas-contato${q}`);
}

export function fetchTarefasLead(arrecadacaoId) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/tarefas-contato`);
}

export function createTarefaContato(data) {
  return apiRequest('/api/tarefas-contato', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTarefaContato(id, data) {
  return apiRequest(`/api/tarefas-contato/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function concluirTarefaContato(id) {
  return apiRequest(`/api/tarefas-contato/${id}/concluir`, { method: 'POST' });
}

export function fetchFunilEtapas({ escopo = 'comercial' } = {}) {
  const q = escopo ? `?escopo=${encodeURIComponent(escopo)}` : '';
  return apiRequest(`/api/funil-etapas${q}`);
}

export function saveFunilEtapas(etapas, { escopo = 'comercial' } = {}) {
  return apiRequest('/api/funil-etapas', {
    method: 'PUT',
    body: JSON.stringify({ etapas, escopo }),
  });
}

export function fetchInteracoes(arrecadacaoId) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/interacoes`);
}

export function createInteracao(arrecadacaoId, data) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/interacoes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchMarketing() {
  return apiRequest('/api/marketing');
}

export function createMarketingCanal(data) {
  return apiRequest('/api/marketing/canais', { method: 'POST', body: JSON.stringify(data) });
}

export function updateMarketingCanal(id, data) {
  return apiRequest(`/api/marketing/canais/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteMarketingCanal(id) {
  return apiRequest(`/api/marketing/canais/${id}`, { method: 'DELETE' });
}

export function createMarketingCampanha(data) {
  return apiRequest('/api/marketing/campanhas', { method: 'POST', body: JSON.stringify(data) });
}

export function updateMarketingCampanha(id, data) {
  return apiRequest(`/api/marketing/campanhas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteMarketingCampanha(id) {
  return apiRequest(`/api/marketing/campanhas/${id}`, { method: 'DELETE' });
}

export function createMarketingCriativo(data) {
  return apiRequest('/api/marketing/criativos', { method: 'POST', body: JSON.stringify(data) });
}

export function updateMarketingCriativo(id, data) {
  return apiRequest(`/api/marketing/criativos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteMarketingCriativo(id) {
  return apiRequest(`/api/marketing/criativos/${id}`, { method: 'DELETE' });
}

export function fetchProducaoCronologia() {
  return apiRequest('/api/producao/cronologia');
}

export function createProducaoCronologia(data) {
  return apiRequest('/api/producao/cronologia', { method: 'POST', body: JSON.stringify(data) });
}

export function updateProducaoCronologia(id, data) {
  return apiRequest(`/api/producao/cronologia/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProducaoCronologia(id) {
  return apiRequest(`/api/producao/cronologia/${id}`, { method: 'DELETE' });
}

export function fetchProducaoPremiacoes() {
  return apiRequest('/api/producao/premiacoes');
}

export function createProducaoPremiacao(data) {
  return apiRequest('/api/producao/premiacoes', { method: 'POST', body: JSON.stringify(data) });
}

export function updateProducaoPremiacao(id, data) {
  return apiRequest(`/api/producao/premiacoes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProducaoPremiacao(id) {
  return apiRequest(`/api/producao/premiacoes/${id}`, { method: 'DELETE' });
}

export function clearFinanceiroResultado() {
  return apiRequest('/api/financeiro/resultado/limpar', { method: 'POST' });
}

export function fetchFinanceiroPainel() {
  return apiRequest('/api/financeiro/painel');
}

export function fetchFinanceiroResultado() {
  return apiRequest('/api/financeiro/resultado');
}

export function carregarModeloFinanceiroResultado({ substituir = false } = {}) {
  return apiRequest('/api/financeiro/resultado/carregar-modelo', {
    method: 'POST',
    body: JSON.stringify({ substituir }),
  });
}

export function createFinanceiroLinha(data) {
  return apiRequest('/api/financeiro/resultado/linhas', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateFinanceiroLinha(id, data) {
  return apiRequest(`/api/financeiro/resultado/linhas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteFinanceiroLinha(id) {
  return apiRequest(`/api/financeiro/resultado/linhas/${id}`, { method: 'DELETE' });
}

export function fetchFinanceiroCategorias() {
  return apiRequest('/api/financeiro/categorias');
}

export function fetchFinanceiroPlanoContas({ categoriaId } = {}) {
  const qs = categoriaId ? `?categoriaId=${encodeURIComponent(categoriaId)}` : '';
  return apiRequest(`/api/financeiro/plano-contas${qs}`);
}

export function createFinanceiroCategoria(data) {
  return apiRequest('/api/financeiro/categorias', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function createFinanceiroPlanoConta(data) {
  return apiRequest('/api/financeiro/plano-contas', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchContasPagar() {
  return apiRequest('/api/financeiro/contas-pagar');
}

export function createContaPagar(data) {
  return apiRequest('/api/financeiro/contas-pagar', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateContaPagar(id, data) {
  return apiRequest(`/api/financeiro/contas-pagar/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteContaPagar(id) {
  return apiRequest(`/api/financeiro/contas-pagar/${id}`, { method: 'DELETE' });
}

export function fetchWhatsappStatus() {
  return apiRequest('/api/whatsapp/status');
}

export function connectWhatsapp(phone) {
  return apiRequest('/api/whatsapp/connect', {
    method: 'POST',
    body: JSON.stringify(phone ? { phone } : {}),
  });
}

export function disconnectWhatsapp() {
  return apiRequest('/api/whatsapp/disconnect', { method: 'POST' });
}

export function fetchLeadWhatsapp(arrecadacaoId, { prepare = false } = {}) {
  const qs = prepare ? '?prepare=1' : '';
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/whatsapp${qs}`, {
    timeoutMs: prepare ? 90000 : 15000,
  });
}

export function syncLeadWhatsapp(arrecadacaoId, { days = 5 } = {}) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/whatsapp/sync`, {
    method: 'POST',
    body: JSON.stringify({ days }),
    timeoutMs: 180000,
  });
}

export function sendLeadWhatsapp(arrecadacaoId, payload) {
  const body = typeof payload === 'string' ? { text: payload } : payload;
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/whatsapp/send`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120000,
  });
}

export function sendLeadWhatsappReaction(arrecadacaoId, mensagemId, emoji) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/whatsapp/messages/${mensagemId}/reaction`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export function fetchLinkPreview(url) {
  const q = new URLSearchParams({ url: String(url || '') });
  return apiRequest(`/api/link-preview?${q}`);
}

export function fetchWhatsappInbox() {
  return apiRequest('/api/whatsapp/inbox');
}

export function fetchWhatsappInboxThread(participanteId) {
  return apiRequest(`/api/whatsapp/inbox/${participanteId}`);
}

export function fetchWhatsappThreadMessages(participanteId, { prepare = true } = {}) {
  const qs = prepare ? '' : '?prepare=0';
  return apiRequest(`/api/whatsapp/inbox/${participanteId}/messages${qs}`, {
    timeoutMs: prepare ? 90000 : 15000,
  });
}

export function syncWhatsappInboxThread(participanteId, { days = 5 } = {}) {
  return apiRequest(`/api/whatsapp/inbox/${participanteId}/sync`, {
    method: 'POST',
    body: JSON.stringify({ days }),
    timeoutMs: 180000,
  });
}

export function sendWhatsappInboxReaction(participanteId, mensagemId, emoji) {
  return apiRequest(`/api/whatsapp/inbox/${participanteId}/messages/${mensagemId}/reaction`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export function sendWhatsappInboxMessage(participanteId, payload) {
  const body = typeof payload === 'string' ? { text: payload } : payload;
  return apiRequest(`/api/whatsapp/inbox/${participanteId}/send`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120000,
  });
}

export function deletePagamento(arrecadacaoId, pagamentoId) {
  return apiRequest(`/api/arrecadacao/${arrecadacaoId}/pagamentos/${pagamentoId}`, {
    method: 'DELETE',
  });
}

export function fetchEventos() {
  return apiRequest('/api/eventos');
}

export function createEvento(data) {
  return apiRequest('/api/eventos', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateEvento(id, data) {
  return apiRequest(`/api/eventos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteEvento(id) {
  return apiRequest(`/api/eventos/${id}`, { method: 'DELETE' });
}

export function fetchEventoComparacao(id) {
  return apiRequest(`/api/eventos/${id}/comparacao`);
}
