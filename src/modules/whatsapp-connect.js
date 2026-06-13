import { connectWhatsapp, disconnectWhatsapp, fetchWhatsappStatus } from '../lib/api.js';

const STATE_LABELS = {
  open: 'Conectado',
  connected: 'Conectado',
  connecting: 'Aguardando leitura do QR',
  close: 'Desconectado',
  not_found: 'Não configurado',
  not_configured: 'API não configurada',
  error: 'Erro na conexão',
  unknown: 'Status desconhecido',
};

function stateKey(status) {
  if (!status?.configured) return 'not_configured';
  return status.state || (status.connected ? 'open' : 'close');
}

export function initWhatsappConnect() {
  const btn = document.getElementById('btn-whatsapp-connect');
  const modalBg = document.getElementById('whatsapp-modal-bg');
  const modalSub = document.getElementById('whatsapp-modal-sub');
  const modalStatus = document.getElementById('whatsapp-modal-status');
  const qrWrap = document.getElementById('whatsapp-qr-wrap');
  const qrImg = document.getElementById('whatsapp-qr-img');
  const pairingCodeEl = document.getElementById('whatsapp-pairing-code');
  const btnRefresh = document.getElementById('whatsapp-btn-refresh');
  const btnDisconnect = document.getElementById('whatsapp-btn-disconnect');
  const btnClose = document.getElementById('whatsapp-btn-close');

  if (!btn || !modalBg) return { refreshStatus: async () => {} };

  let currentStatus = null;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function updateHeaderButton(status) {
    currentStatus = status;
    const key = stateKey(status);
    btn.dataset.state = key;
    btn.title = `WhatsApp: ${STATE_LABELS[key] || key}`;
    btn.setAttribute('aria-label', btn.title);

    const label = btn.querySelector('.wa-header-label');
    if (label) {
      if (!status?.configured) label.textContent = 'WhatsApp';
      else if (status.connected) label.textContent = 'WhatsApp conectado';
      else if (key === 'connecting') label.textContent = 'Conectando…';
      else label.textContent = 'Conectar WhatsApp';
    }
  }

  function renderModal(status, { qrcode } = {}) {
    const key = stateKey(status);
    const instance = status?.instance ? `Instância “${status.instance}”.` : '';

    if (!status?.configured) {
      modalSub.textContent = 'A Evolution API não está configurada no servidor.';
      modalStatus.innerHTML =
        '<p class="wa-modal-message">Peça ao administrador para definir <code>EVOLUTION_API_URL</code>, <code>EVOLUTION_API_KEY</code> e <code>EVOLUTION_INSTANCE</code> no ambiente.</p>';
      qrWrap.classList.add('hidden');
      btnRefresh.classList.add('hidden');
      btnDisconnect.classList.add('hidden');
      return;
    }

    if (status.connected) {
      modalSub.textContent = `${instance} Pronto para enviar e receber mensagens nos leads.`;
      modalStatus.innerHTML =
        '<p class="wa-modal-message wa-modal-message--ok">WhatsApp conectado com sucesso.</p>';
      qrWrap.classList.add('hidden');
      btnRefresh.classList.add('hidden');
      btnDisconnect.classList.remove('hidden');
      stopPolling();
      return;
    }

    modalSub.textContent = `${instance} Escaneie o QR Code no celular para vincular o WhatsApp.`;
    modalStatus.innerHTML = `<p class="wa-modal-message">${STATE_LABELS[key] || 'Aguardando conexão…'}</p>`;
    btnDisconnect.classList.add('hidden');
    btnRefresh.classList.remove('hidden');

    const qr = qrcode || null;
    if (qr?.base64) {
      qrWrap.classList.remove('hidden');
      qrImg.src = qr.base64;
      qrImg.alt = 'QR Code para conectar WhatsApp';
    } else {
      qrWrap.classList.add('hidden');
      qrImg.removeAttribute('src');
    }

    if (qr?.pairingCode) {
      pairingCodeEl.textContent = `Código de pareamento: ${qr.pairingCode}`;
      pairingCodeEl.classList.remove('hidden');
    } else {
      pairingCodeEl.textContent = '';
      pairingCodeEl.classList.add('hidden');
    }
  }

  async function refreshStatus({ silent = false } = {}) {
    try {
      const status = await fetchWhatsappStatus();
      updateHeaderButton(status);
      if (modalBg.classList.contains('open')) {
        renderModal(status);
      }
      return status;
    } catch (err) {
      if (!silent) console.warn('WhatsApp status:', err.message);
      return currentStatus;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const status = await refreshStatus({ silent: true });
      if (status?.connected) {
        renderModal(status);
        stopPolling();
      }
    }, 3000);
  }

  async function openModal() {
    modalBg.classList.add('open');
    modalStatus.innerHTML = '<p class="cell-muted">Carregando…</p>';
    qrWrap.classList.add('hidden');
    btnRefresh.disabled = true;

    try {
      const result = await connectWhatsapp();
      updateHeaderButton(result);
      renderModal(result, { qrcode: result.qrcode });
      if (!result.connected) startPolling();
    } catch (err) {
      modalSub.textContent = 'Não foi possível iniciar a conexão.';
      modalStatus.innerHTML = `<p class="wa-modal-message wa-modal-message--err">${err.message}</p>`;
      qrWrap.classList.add('hidden');
    } finally {
      btnRefresh.disabled = false;
    }
  }

  function closeModal() {
    modalBg.classList.remove('open');
    stopPolling();
  }

  async function refreshQr() {
    btnRefresh.disabled = true;
    btnRefresh.textContent = 'Atualizando…';
    try {
      const result = await connectWhatsapp();
      updateHeaderButton(result);
      renderModal(result, { qrcode: result.qrcode });
      if (!result.connected) startPolling();
    } catch (err) {
      modalStatus.innerHTML = `<p class="wa-modal-message wa-modal-message--err">${err.message}</p>`;
    } finally {
      btnRefresh.disabled = false;
      btnRefresh.textContent = 'Atualizar QR';
    }
  }

  async function disconnect() {
    if (!confirm('Desconectar o WhatsApp desta instância?')) return;
    btnDisconnect.disabled = true;
    try {
      const status = await disconnectWhatsapp();
      updateHeaderButton(status);
      renderModal(status);
    } catch (err) {
      alert(err.message);
    } finally {
      btnDisconnect.disabled = false;
    }
  }

  btn.addEventListener('click', openModal);
  btnRefresh?.addEventListener('click', refreshQr);
  btnDisconnect?.addEventListener('click', disconnect);
  btnClose?.addEventListener('click', closeModal);
  modalBg.addEventListener('click', (e) => {
    if (e.target === modalBg) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBg.classList.contains('open')) closeModal();
  });

  refreshStatus({ silent: true });
  setInterval(() => refreshStatus({ silent: true }), 45000);

  return { refreshStatus, updateHeaderButton };
}
