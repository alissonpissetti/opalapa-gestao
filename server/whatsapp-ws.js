import { WebSocketServer } from 'ws';
import { verifyToken, COOKIE_NAME } from './auth.js';

const clients = new Set();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1);
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function broadcastWhatsappEvent(event, data) {
  const payload = { type: event, data, at: new Date().toISOString() };
  const raw = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
}

export function attachWhatsappWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/whatsapp' });

  wss.on('connection', (ws, req) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      ws.close(4401, 'Não autenticado');
      return;
    }

    ws.userId = payload.sub;
    clients.add(ws);

    safeSend(ws, { type: 'connected', data: { ok: true } });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return wss;
}
