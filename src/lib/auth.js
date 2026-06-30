import { apiRequest } from './api.js';
import { setUserPermissions, applyWhatsappHeaderPermissions } from './permissions.js';

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
    setUserPermissions(data.user);
    applyWhatsappHeaderPermissions();
    return data.user;
  } catch (err) {
    if (err.status === 401) {
      currentUser = null;
      setUserPermissions(null);
      applyWhatsappHeaderPermissions();
      return null;
    }
    throw err;
  }
}

export async function login(loginValue, password) {
  const data = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: loginValue, password }),
  });
  currentUser = data.user;
  setUserPermissions(data.user);
  applyWhatsappHeaderPermissions();
  return data.user;
}

export async function sendAuthOtp(login, purpose) {
  return apiRequest('/api/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ login, purpose }),
  });
}

export async function verifySmsLogin(login, code) {
  const data = await apiRequest('/api/auth/otp/verify-login', {
    method: 'POST',
    body: JSON.stringify({ login, code }),
  });
  currentUser = data.user;
  setUserPermissions(data.user);
  applyWhatsappHeaderPermissions();
  return data.user;
}

export async function resetPasswordWithOtp(login, code, password) {
  const data = await apiRequest('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ login, code, password }),
  });
  currentUser = data.user;
  setUserPermissions(data.user);
  applyWhatsappHeaderPermissions();
  return data.user;
}

export async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    currentUser = null;
    setUserPermissions(null);
    applyWhatsappHeaderPermissions();
  }
}
