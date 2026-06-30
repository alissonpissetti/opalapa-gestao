import {
  login,
  sendAuthOtp,
  verifySmsLogin,
  resetPasswordWithOtp,
  setCurrentUser,
} from '../lib/auth.js';
import { setUserPermissions, getDefaultView, applyWhatsappHeaderPermissions } from '../lib/permissions.js';

function maskPhoneInput(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 11);
  if (!digits) {
    el.value = '';
    return;
  }
  if (digits.length <= 2) {
    el.value = `(${digits}`;
    return;
  }
  if (digits.length <= 6) {
    el.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return;
  }
  if (digits.length <= 10) {
    el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return;
  }
  el.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function initLoginScreen(onSuccess) {
  const screen = document.getElementById('login-screen');
  const tabs = document.querySelectorAll('.login-tab');
  const panels = {
    password: document.getElementById('login-panel-password'),
    sms: document.getElementById('login-panel-sms'),
    forgot: document.getElementById('login-panel-forgot'),
  };
  const subtitle = document.getElementById('login-subtitle');
  const errorEl = document.getElementById('login-error');
  const hintEl = document.getElementById('login-hint');

  const passwordForm = document.getElementById('login-form-password');
  const smsForm = document.getElementById('login-form-sms');
  const forgotForm = document.getElementById('login-form-forgot');

  const passwordLogin = document.getElementById('login-input');
  const passwordField = document.getElementById('login-password');
  const passwordSubmit = document.getElementById('login-submit-password');

  const smsPhone = document.getElementById('login-sms-phone');
  const smsCodeWrap = document.getElementById('login-sms-code-wrap');
  const smsCode = document.getElementById('login-sms-code');
  const smsSendBtn = document.getElementById('login-sms-send');
  const smsSubmit = document.getElementById('login-sms-submit');

  const forgotLogin = document.getElementById('login-forgot-input');
  const forgotCodeWrap = document.getElementById('login-forgot-code-wrap');
  const forgotPasswordWrap = document.getElementById('login-forgot-password-wrap');
  const forgotCode = document.getElementById('login-forgot-code');
  const forgotPassword = document.getElementById('login-forgot-password');
  const forgotSendBtn = document.getElementById('login-forgot-send');
  const forgotSubmit = document.getElementById('login-forgot-submit');
  const forgotBack = document.getElementById('login-forgot-back');

  let activePanel = 'password';
  let smsCodeSent = false;
  let forgotCodeSent = false;

  function clearMessages() {
    errorEl.textContent = '';
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
  }

  function showError(message) {
    errorEl.textContent = message || 'Não foi possível continuar';
  }

  function showHint(message) {
    hintEl.textContent = message;
    hintEl.classList.remove('hidden');
  }

  function setPanel(name) {
    activePanel = name;
    Object.entries(panels).forEach(([key, el]) => {
      el?.classList.toggle('hidden', key !== name);
    });
    tabs.forEach((tab) => {
      const isActive = tab.dataset.panel === name && name !== 'forgot';
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    tabs.forEach((tab) => {
      tab.classList.toggle('hidden', name === 'forgot');
    });

    if (name === 'password') {
      subtitle.textContent = 'Entre com e-mail ou celular e senha.';
    } else if (name === 'sms') {
      subtitle.textContent = 'Receba um código por SMS no celular cadastrado.';
    } else {
      subtitle.textContent = 'Redefina sua senha com o código enviado por SMS.';
    }
    clearMessages();
  }

  function resetSmsFlow() {
    smsCodeSent = false;
    smsCodeWrap?.classList.add('hidden');
    if (smsCode) smsCode.value = '';
    if (smsSubmit) smsSubmit.classList.add('hidden');
    if (smsSendBtn) {
      smsSendBtn.textContent = 'Enviar código';
      smsSendBtn.disabled = false;
    }
  }

  function resetForgotFlow() {
    forgotCodeSent = false;
    forgotCodeWrap?.classList.add('hidden');
    forgotPasswordWrap?.classList.add('hidden');
    if (forgotCode) forgotCode.value = '';
    if (forgotPassword) forgotPassword.value = '';
    if (forgotSubmit) forgotSubmit.classList.add('hidden');
    if (forgotSendBtn) {
      forgotSendBtn.textContent = 'Enviar código';
      forgotSendBtn.disabled = false;
    }
  }

  function finishLogin(user) {
    setCurrentUser(user);
    setUserPermissions(user);
    applyWhatsappHeaderPermissions();
    const defaultView = getDefaultView();
    if (defaultView) {
      history.replaceState({ view: defaultView }, '', `#${defaultView}`);
    } else {
      history.replaceState({}, '', '#');
    }
    onSuccess(user);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.panel === 'password') {
        resetSmsFlow();
        setPanel('password');
        passwordLogin?.focus();
      } else if (tab.dataset.panel === 'sms') {
        resetSmsFlow();
        setPanel('sms');
        smsPhone?.focus();
      }
    });
  });

  document.getElementById('login-forgot-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    resetForgotFlow();
    if (passwordLogin?.value.trim()) {
      forgotLogin.value = passwordLogin.value.trim();
    }
    setPanel('forgot');
    forgotLogin?.focus();
  });

  forgotBack?.addEventListener('click', (e) => {
    e.preventDefault();
    resetForgotFlow();
    setPanel('password');
  });

  passwordForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    passwordSubmit.disabled = true;
    passwordSubmit.textContent = 'Entrando…';
    try {
      const user = await login(passwordLogin.value, passwordField.value);
      finishLogin(user);
    } catch (err) {
      showError(err.message);
      passwordField.focus();
    } finally {
      passwordSubmit.disabled = false;
      passwordSubmit.textContent = 'Entrar';
    }
  });

  smsPhone?.addEventListener('input', () => maskPhoneInput(smsPhone));
  forgotLogin?.addEventListener('input', (e) => {
    if (String(e.target.value).includes('@')) return;
    maskPhoneInput(forgotLogin);
  });

  smsSendBtn?.addEventListener('click', async () => {
    clearMessages();
    smsSendBtn.disabled = true;
    smsSendBtn.textContent = 'Enviando…';
    try {
      const result = await sendAuthOtp(smsPhone.value, 'login');
      smsCodeSent = true;
      smsCodeWrap?.classList.remove('hidden');
      smsSubmit?.classList.remove('hidden');
      let hint = `Código enviado para ${result.phoneMask || 'seu celular'}.`;
      if (result.devCode) hint += ` (dev: ${result.devCode})`;
      showHint(hint);
      smsCode?.focus();
      smsSendBtn.textContent = 'Reenviar código';
    } catch (err) {
      showError(err.message);
    } finally {
      smsSendBtn.disabled = false;
    }
  });

  smsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!smsCodeSent) {
      smsSendBtn?.click();
      return;
    }
    clearMessages();
    smsSubmit.disabled = true;
    smsSubmit.textContent = 'Validando…';
    try {
      const user = await verifySmsLogin(smsPhone.value, smsCode.value);
      finishLogin(user);
    } catch (err) {
      showError(err.message);
      smsCode.focus();
    } finally {
      smsSubmit.disabled = false;
      smsSubmit.textContent = 'Entrar com código';
    }
  });

  forgotSendBtn?.addEventListener('click', async () => {
    clearMessages();
    forgotSendBtn.disabled = true;
    forgotSendBtn.textContent = 'Enviando…';
    try {
      const result = await sendAuthOtp(forgotLogin.value, 'password_reset');
      forgotCodeSent = true;
      forgotCodeWrap?.classList.remove('hidden');
      forgotPasswordWrap?.classList.remove('hidden');
      forgotSubmit?.classList.remove('hidden');
      let hint = `Código enviado para ${result.phoneMask || 'o celular cadastrado'}.`;
      if (result.devCode) hint += ` (dev: ${result.devCode})`;
      showHint(hint);
      forgotCode?.focus();
      forgotSendBtn.textContent = 'Reenviar código';
    } catch (err) {
      showError(err.message);
    } finally {
      forgotSendBtn.disabled = false;
    }
  });

  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!forgotCodeSent) {
      forgotSendBtn?.click();
      return;
    }
    clearMessages();
    forgotSubmit.disabled = true;
    forgotSubmit.textContent = 'Salvando…';
    try {
      const user = await resetPasswordWithOtp(
        forgotLogin.value,
        forgotCode.value,
        forgotPassword.value,
      );
      finishLogin(user);
    } catch (err) {
      showError(err.message);
    } finally {
      forgotSubmit.disabled = false;
      forgotSubmit.textContent = 'Redefinir senha';
    }
  });

  return {
    show() {
      screen.classList.remove('hidden');
      resetSmsFlow();
      resetForgotFlow();
      setPanel('password');
      passwordLogin?.focus();
    },
    hide() {
      screen.classList.add('hidden');
      passwordForm?.reset();
      smsForm?.reset();
      forgotForm?.reset();
      resetSmsFlow();
      resetForgotFlow();
      clearMessages();
      setPanel('password');
    },
    showError(message) {
      showError(message);
    },
  };
}
