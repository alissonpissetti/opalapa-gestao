export function getNextcloudConfig() {
  const baseUrl = (process.env.NEXTCLOUD_URL || process.env.SERVICE_URL_NEXTCLOUD || '').replace(
    /\/$/,
    '',
  );
  const user = process.env.NEXTCLOUD_USER || '';
  const password = process.env.NEXTCLOUD_PASSWORD || '';
  const basePath = (process.env.NEXTCLOUD_WHATSAPP_PATH || '/opalapa/whatsapp').replace(/\/$/, '');

  return {
    baseUrl,
    user,
    password,
    basePath,
    enabled: Boolean(baseUrl && user && password),
  };
}

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function davFileUrl(baseUrl, user, remotePath) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const segments = String(remotePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `${cleanBase}/remote.php/dav/files/${encodeURIComponent(user)}/${segments.join('/')}`;
}

function cloneBodyBuffer(buffer) {
  if (!buffer) return Buffer.alloc(0);
  return Buffer.from(buffer);
}

async function putWithBody(url, auth, mimetype, buffer) {
  const body = cloneBodyBuffer(buffer);
  const res = await fetch(url, {
    method: 'PUT',
    redirect: 'manual',
    headers: {
      Authorization: auth,
      'Content-Type': mimetype || 'application/octet-stream',
    },
    body,
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) {
      throw Object.assign(new Error(`Nextcloud PUT redirecionou sem Location (${res.status})`), {
        status: res.status,
      });
    }
    const redirectUrl = new URL(location, url).href;
    const retryBody = cloneBodyBuffer(buffer);
    const retry = await fetch(redirectUrl, {
      method: 'PUT',
      redirect: 'manual',
      headers: {
        Authorization: auth,
        'Content-Type': mimetype || 'application/octet-stream',
      },
      body: retryBody,
    });
    if (!retry.ok) {
      const text = await retry.text();
      throw Object.assign(new Error(`Nextcloud PUT ${retry.status}: ${text.slice(0, 200)}`), {
        status: retry.status,
      });
    }
    return retry;
  }

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Nextcloud PUT ${res.status}: ${text.slice(0, 200)}`), {
      status: res.status,
    });
  }

  return res;
}

async function ensureCollection(url, auth) {
  const res = await fetch(url, { method: 'MKCOL', headers: { Authorization: auth } });
  if (res.status === 201 || res.status === 405 || res.status === 409) return;
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Nextcloud MKCOL ${res.status}: ${text.slice(0, 200)}`), {
      status: res.status,
    });
  }
}

export async function ensureNextcloudPath(remotePath) {
  const config = getNextcloudConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Nextcloud não configurado no servidor'), { status: 503 });
  }

  const auth = basicAuth(config.user, config.password);
  const parts = String(remotePath || '')
    .split('/')
    .filter(Boolean);
  if (parts.length <= 1) return;

  let current = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    current += `/${parts[i]}`;
    await ensureCollection(davFileUrl(config.baseUrl, config.user, current), auth);
  }
}

export async function uploadToNextcloud(remotePath, buffer, mimetype) {
  const config = getNextcloudConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Nextcloud não configurado no servidor'), { status: 503 });
  }

  await ensureNextcloudPath(remotePath);

  const auth = basicAuth(config.user, config.password);
  const url = davFileUrl(config.baseUrl, config.user, remotePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    await putWithBody(url, auth, mimetype, buffer);
    return { path: remotePath, url };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Nextcloud demorou para responder no upload'), { status: 504 });
    }
    if (err.cause?.code === 'ENOTFOUND' || err.cause?.code === 'ECONNREFUSED') {
      throw Object.assign(
        new Error(`Nextcloud inacessível em ${config.baseUrl}. Verifique NEXTCLOUD_URL e credenciais.`),
        { status: 503 },
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadFromNextcloud(remotePath) {
  const config = getNextcloudConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Nextcloud não configurado no servidor'), { status: 503 });
  }

  const auth = basicAuth(config.user, config.password);
  const url = davFileUrl(config.baseUrl, config.user, remotePath);
  const res = await fetch(url, { headers: { Authorization: auth } });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Nextcloud GET ${res.status}: ${text.slice(0, 200)}`), {
      status: res.status,
    });
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
