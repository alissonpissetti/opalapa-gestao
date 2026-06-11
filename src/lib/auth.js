import { apiRequest } from './api.js';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function setCurrentUser(user) {
  currentUser = user;
}

export async function fetchSession() {
  try {
    const data = await apiRequest('/api/auth/me');
    currentUser = data.user;
    return data.user;
  } catch (err) {
    if (err.status === 401) {
      currentUser = null;
      return null;
    }
    throw err;
  }
}

export async function login(login, password) {
  const data = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  currentUser = data.user;
  return data.user;
}

export async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    currentUser = null;
  }
}
