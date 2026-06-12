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
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
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
    } catch (_) {}
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

export function fetchFunilEtapas() {
  return apiRequest('/api/funil-etapas');
}

export function saveFunilEtapas(etapas) {
  return apiRequest('/api/funil-etapas', {
    method: 'PUT',
    body: JSON.stringify({ etapas }),
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
