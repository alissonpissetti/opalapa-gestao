import { login } from '../lib/auth.js';

export function initLoginScreen(onSuccess) {
  const screen = document.getElementById('login-screen');
  const form = document.getElementById('login-form');
  const loginInput = document.getElementById('login-input');
  const passwordInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';

    try {
      const user = await login(loginInput.value, passwordInput.value);
      onSuccess(user);
    } catch (err) {
      errorEl.textContent = err.message || 'Não foi possível entrar';
      passwordInput.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });

  return {
    show() {
      screen.classList.remove('hidden');
      loginInput.focus();
    },
    hide() {
      screen.classList.add('hidden');
      form.reset();
      errorEl.textContent = '';
    },
    showError(message) {
      errorEl.textContent = message;
    },
  };
}
