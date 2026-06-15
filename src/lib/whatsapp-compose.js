const ICON_ATTACH =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M16.5 6v11.5a4 4 0 1 1-8 0V5.5a2.5 2.5 0 0 1 5 0v10a1 1 0 1 1-2 0V6H9.5v9.5a3.5 3.5 0 0 0 7 0V5.5a4 4 0 0 0-8 0v12a5.5 5.5 0 0 0 11 0V6z"/></svg>';
const ICON_MIC =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MIN_AUDIO_MS = 600;

function formatRecordingTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function pickRecorderMimeType() {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(blob);
  });
}

function extensionFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
  };
  const base = String(mime || '').split(';')[0].toLowerCase();
  return map[base] || 'bin';
}

function updateComposeActions(input, micBtn, sendBtn) {
  const hasText = Boolean(input?.value.trim());
  if (micBtn) micBtn.hidden = hasText;
  if (sendBtn) sendBtn.hidden = !hasText;
}

export function initWhatsappCompose({
  formEl,
  inputEl,
  onSendText,
  onSendMedia,
  fileInputId,
  attachBtnId,
  micBtnId,
  sendBtnId,
  recordingPanelId,
}) {
  if (!formEl || !inputEl || !onSendText || !onSendMedia) return () => {};

  const fileInput = fileInputId ? document.getElementById(fileInputId) : null;
  let attachBtn = attachBtnId ? document.getElementById(attachBtnId) : null;
  let micBtn = micBtnId ? document.getElementById(micBtnId) : null;
  let sendBtn = sendBtnId ? document.getElementById(sendBtnId) : null;
  const recordingPanel = recordingPanelId ? document.getElementById(recordingPanelId) : null;

  if (!attachBtn) {
    attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'wa-compose-attach';
    attachBtn.title = 'Enviar imagem';
    attachBtn.setAttribute('aria-label', 'Enviar imagem');
    attachBtn.innerHTML = ICON_ATTACH;
    formEl.insertBefore(attachBtn, inputEl);
  }

  if (!micBtn) {
    micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'wa-compose-mic';
    micBtn.title = 'Gravar áudio';
    micBtn.setAttribute('aria-label', 'Gravar áudio');
    micBtn.innerHTML = ICON_MIC;
    formEl.appendChild(micBtn);
  }

  if (sendBtn) {
    sendBtn.classList.add('wa-compose-send');
    if (!sendBtn.querySelector('svg')) {
      sendBtn.innerHTML = `${ICON_SEND}<span class="wa-compose-send-label">Enviar</span>`;
    }
  }

  let recordingTimer = null;
  let recordingStartedAt = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let busy = false;

  const recordingTimeEl = recordingPanel?.querySelector('.wa-compose-recording-time');
  const recordingCancelBtn = recordingPanel?.querySelector('.wa-compose-recording-cancel');
  const recordingSendBtn = recordingPanel?.querySelector('.wa-compose-recording-send');

  function setBusy(next) {
    busy = next;
    formEl.classList.toggle('is-busy', busy);
    if (attachBtn) attachBtn.disabled = busy;
    if (micBtn) micBtn.disabled = busy;
    if (sendBtn) sendBtn.disabled = busy;
    if (inputEl) inputEl.disabled = busy;
  }

  function stopStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function hideRecordingPanel() {
    if (recordingPanel) recordingPanel.hidden = true;
    formEl.classList.remove('is-recording');
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }

  function cleanupRecorder() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    audioChunks = [];
    stopStream();
    hideRecordingPanel();
    if (micBtn) micBtn.classList.remove('is-active');
  }

  async function sendImageFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Selecione um arquivo de imagem.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert('Imagem muito grande. O limite é 12 MB.');
      return;
    }

    setBusy(true);
    try {
      const media = await blobToDataUrl(file);
      await onSendMedia({
        mediaType: 'image',
        media,
        mimetype: file.type,
        fileName: file.name || `imagem.${extensionFromMime(file.type)}`,
        caption: inputEl.value.trim(),
      });
      inputEl.value = '';
      updateComposeActions(inputEl, micBtn, sendBtn);
    } catch (err) {
      alert(err.message || 'Falha ao enviar imagem');
    } finally {
      setBusy(false);
    }
  }

  async function sendRecordedAudio() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    const recorder = mediaRecorder;
    const mimeType = recorder.mimeType || pickRecorderMimeType() || 'audio/webm';

    const blob = await new Promise((resolve, reject) => {
      recorder.addEventListener(
        'stop',
        () => {
          const result = new Blob(audioChunks, { type: mimeType });
          if (!result.size) {
            reject(new Error('Áudio vazio'));
            return;
          }
          resolve(result);
        },
        { once: true },
      );
      recorder.addEventListener('error', () => reject(new Error('Falha na gravação')), { once: true });
      try {
        recorder.stop();
      } catch (err) {
        reject(err);
      }
    });

    const durationMs = Date.now() - recordingStartedAt;
    cleanupRecorder();
    if (durationMs < MIN_AUDIO_MS) {
      alert('Gravação muito curta.');
      return;
    }

    setBusy(true);
    try {
      const media = await blobToDataUrl(blob);
      await onSendMedia({
        mediaType: 'audio',
        media,
        mimetype: mimeType,
        fileName: `audio.${extensionFromMime(mimeType)}`,
      });
    } catch (err) {
      alert(err.message || 'Falha ao enviar áudio');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (busy || mediaRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Seu navegador não permite gravar áudio aqui.');
      return;
    }

    const mimeType = pickRecorderMimeType();
    if (!mimeType) {
      alert('Seu navegador não suporta gravação de áudio.');
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) audioChunks.push(event.data);
      });
      mediaRecorder.start(250);
      recordingStartedAt = Date.now();
      micBtn?.classList.add('is-active');
      formEl.classList.add('is-recording');
      if (recordingPanel) recordingPanel.hidden = false;
      if (recordingTimeEl) recordingTimeEl.textContent = '0:00';
      recordingTimer = setInterval(() => {
        if (recordingTimeEl) {
          recordingTimeEl.textContent = formatRecordingTime(Date.now() - recordingStartedAt);
        }
      }, 250);
    } catch {
      cleanupRecorder();
      alert('Não foi possível acessar o microfone.');
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const text = inputEl.value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSendText(text);
      inputEl.value = '';
      updateComposeActions(inputEl, micBtn, sendBtn);
    } catch (err) {
      alert(err.message || 'Falha ao enviar mensagem');
    } finally {
      setBusy(false);
    }
  }

  function onInputChange() {
    updateComposeActions(inputEl, micBtn, sendBtn);
  }

  formEl.addEventListener('submit', onSubmit);
  inputEl.addEventListener('input', onInputChange);
  inputEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (inputEl.value.trim()) formEl.requestSubmit();
  });

  attachBtn?.addEventListener('click', () => {
    if (busy) return;
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void sendImageFile(file);
  });

  micBtn?.addEventListener('click', () => {
    if (busy) return;
    if (mediaRecorder) {
      void sendRecordedAudio();
      return;
    }
    void startRecording();
  });

  recordingCancelBtn?.addEventListener('click', () => cleanupRecorder());
  recordingSendBtn?.addEventListener('click', () => {
    if (mediaRecorder) void sendRecordedAudio();
  });

  updateComposeActions(inputEl, micBtn, sendBtn);

  return () => {
    cleanupRecorder();
    formEl.removeEventListener('submit', onSubmit);
    inputEl.removeEventListener('input', onInputChange);
  };
}
