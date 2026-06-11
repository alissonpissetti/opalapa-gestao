const API_BASE = import.meta.env.VITE_API_URL || '';

let onUnauthorized = null;

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
      headers: { 'Content-Type': 'application/json', ...options.headers },
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

export function deleteParticipante(id) {
  return apiRequest(`/api/participantes/${id}`, { method: 'DELETE' });
}

export function fetchArrecadacao() {
  return apiRequest('/api/arrecadacao');
}

export function createPatrocinio(data) {
  return apiRequest('/api/arrecadacao', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateArrecadacao(id, data) {
  return apiRequest(`/api/arrecadacao/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteArrecadacao(id) {
  return apiRequest(`/api/arrecadacao/${id}`, { method: 'DELETE' });
}
