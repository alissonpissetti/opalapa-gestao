import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from './db.js';
import { migrateEspacos, fetchSpacesByGrupo, upsertSpaces, moveEspacoReserva } from './espacos.js';
import { fetchGrupos } from './grupos.js';
import { migrateTiposComercio, fetchTiposComercio, ensureTiposComercio } from './tipos.js';
import {
  migrateUsers,
  findUserByLogin,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  normalizeUserInput,
  publicUserRow,
  countUsers,
} from './users.js';
import {
  migrateParticipantes,
  listParticipantes,
  createParticipante,
  updateParticipante,
  deleteParticipante,
  countReferenciasParticipante,
} from './participantes.js';
import {
  migrateArrecadacao,
  syncAllArrecadacaoFromEspacos,
  listArrecadacao,
  listEspacosDisponiveis,
  createPatrocinio,
  updateArrecadacao,
  migrateArrecadacaoToArtistico,
  deleteArrecadacao,
  registerPerdaLead,
  registerPagamento,
  deletePagamento,
  listPagamentosByArrecadacao,
  listPagamentosByParticipante,
  summarizeArrecadacao,
  findArrecadacaoById,
} from './arrecadacao.js';
import {
  migrateEventos,
  listEventos,
  findEventoById,
  createEvento,
  updateEvento,
  deleteEvento,
  compararEvento,
  createRequireEvento,
} from './eventos.js';
import {
  migrateTarefas,
  listTarefasContato,
  listTarefasContatoByArrecadacao,
  createTarefaContato,
  updateTarefaContato,
  concluirTarefaContato,
} from './tarefas.js';
import { migrateFunil, listFunilEtapas, saveFunilEtapas, FUNIL_ESCOPOS } from './funil.js';
import { migrateInteracoes, listInteracoes, createInteracao } from './interacoes.js';
import {
  migrateMarketing,
  listMarketingTree,
  createMarketingCanal,
  createMarketingCampanha,
  createMarketingCriativo,
  updateMarketingCanal,
  updateMarketingCampanha,
  updateMarketingCriativo,
  deleteMarketingCanal,
  deleteMarketingCampanha,
  deleteMarketingCriativo,
} from './marketing.js';
import {
  migrateWhatsapp,
  listWhatsappMessages,
  syncWhatsappHistory,
  sendWhatsappToLead,
  handleEvolutionWebhook,
  getWhatsappStatus,
  getWhatsappStatusQuick,
  connectWhatsapp,
  disconnectWhatsapp,
  validateWebhookSecret,
  reactToWhatsappMessage,
} from './whatsapp.js';
import {
  listWhatsappInbox,
  listMessagesForParticipante,
  syncInboxParticipante,
} from './whatsapp-inbox.js';
import { attachWhatsappWebSocket } from './whatsapp-ws.js';
import { configureInstanceWebhook, getEvolutionConfig } from './evolution.js';
import { streamWhatsappMensagemMedia } from './whatsapp-media.js';
import {
  migrateSeguidoresHistorico,
  getSeguidoresHistoricoResumo,
} from './seguidores-historico.js';
import {
  normalizeLogin,
  verifyPassword,
  hashPassword,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  publicUser,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env');
  process.exit(1);
}

const pool = createPool(DATABASE_URL);
const requireEvento = createRequireEvento(pool);
const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const login = normalizeLogin(req.body?.login);
    const password = req.body?.password;

    if (!login) {
      return res.status(400).json({ error: 'Informe e-mail ou celular' });
    }
    if (!password || !String(password).trim()) {
      return res.status(400).json({ error: 'Informe a senha' });
    }

    const user = await findUserByLogin(pool, login);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'E-mail/celular ou senha incorretos' });
    }

    const token = signToken(user);
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: 'Falha ao entrar' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(pool, req.user.id);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('GET /api/auth/me', err);
    res.status(500).json({ error: 'Falha ao validar sessão' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/tipos-comercio', requireAuth, async (_req, res) => {
  try {
    const tipos = await fetchTiposComercio(pool);
    res.json({ tipos });
  } catch (err) {
    console.error('GET /api/tipos-comercio', err);
    res.status(500).json({ error: 'Falha ao carregar tipos de comércio' });
  }
});

app.get('/api/eventos', requireAuth, async (_req, res) => {
  try {
    const eventos = await listEventos(pool);
    res.json({ eventos });
  } catch (err) {
    console.error('GET /api/eventos', err);
    res.status(500).json({ error: 'Falha ao carregar eventos' });
  }
});

app.post('/api/eventos', requireAuth, async (req, res) => {
  try {
    const evento = await createEvento(pool, req.body);
    res.status(201).json({ evento });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/eventos', err);
    res.status(500).json({ error: 'Falha ao criar evento' });
  }
});

app.put('/api/eventos/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const evento = await updateEvento(pool, id, req.body);
    if (!evento) return res.status(404).json({ error: 'Evento não encontrado' });
    res.json({ evento });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/eventos/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar evento' });
  }
});

app.delete('/api/eventos/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const deleted = await deleteEvento(pool, id);
    if (!deleted) return res.status(404).json({ error: 'Evento não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/eventos/:id', err);
    res.status(500).json({ error: 'Falha ao excluir evento' });
  }
});

app.get('/api/eventos/:id/comparacao', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const data = await compararEvento(pool, id);
    if (!data) return res.status(404).json({ error: 'Evento não encontrado' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/eventos/:id/comparacao', err);
    res.status(500).json({ error: 'Falha ao carregar comparação' });
  }
});

app.get('/api/grupos', requireAuth, requireEvento, async (req, res) => {
  try {
    const grupos = await fetchGrupos(pool, req.eventoId);
    res.json({ grupos });
  } catch (err) {
    console.error('GET /api/grupos', err);
    res.status(500).json({ error: 'Falha ao carregar agrupamentos' });
  }
});

app.get('/api/grupos/:slug/espacos', requireAuth, requireEvento, async (req, res) => {
  try {
    const result = await fetchSpacesByGrupo(pool, req.params.slug, req.eventoId);
    const participantes = await listParticipantes(pool);
    res.json({ ...result, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/grupos/:slug/espacos', err);
    res.status(500).json({ error: 'Falha ao carregar espaços' });
  }
});

app.get('/api/participantes', requireAuth, async (_req, res) => {
  try {
    const participantes = await listParticipantes(pool);
    res.json({ participantes });
  } catch (err) {
    console.error('GET /api/participantes', err);
    res.status(500).json({ error: 'Falha ao carregar participantes' });
  }
});

app.post('/api/participantes', requireAuth, async (req, res) => {
  try {
    const participante = await createParticipante(pool, req.body);
    res.status(201).json({ participante });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/participantes', err);
    res.status(500).json({ error: 'Falha ao criar participante' });
  }
});

app.put('/api/participantes/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const participante = await updateParticipante(pool, id, req.body);
    if (!participante) return res.status(404).json({ error: 'Participante não encontrado' });
    res.json({ participante });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/participantes/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar participante' });
  }
});

app.get('/api/participantes/:id/seguidores-historico', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const data = await getSeguidoresHistoricoResumo(pool, id);
    res.json(data);
  } catch (err) {
    console.error('GET /api/participantes/:id/seguidores-historico', err);
    res.status(500).json({ error: 'Falha ao carregar histórico de seguidores' });
  }
});

app.delete('/api/participantes/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const refs = await countReferenciasParticipante(pool, id, req.eventoId);
    if (refs.total > 0) {
      const partes = [];
      if (refs.espacos > 0) partes.push(`${refs.espacos} espaço(s)`);
      if (refs.arrecadacao > 0) partes.push(`${refs.arrecadacao} registro(s) de arrecadação`);
      return res.status(400).json({
        error: `Participante vinculado a ${partes.join(' e ')}. Remova os vínculos antes de excluir.`,
      });
    }
    const deleted = await deleteParticipante(pool, id);
    if (!deleted) return res.status(404).json({ error: 'Participante não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/participantes/:id', err);
    res.status(500).json({ error: 'Falha ao excluir participante' });
  }
});

app.get('/api/arrecadacao', requireAuth, requireEvento, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'comercial');
    const allowedScopes = new Set(['comercial', 'artistico']);
    if (!allowedScopes.has(scope)) {
      return res.status(400).json({ error: 'Escopo inválido' });
    }
    const items = await listArrecadacao(pool, req.eventoId, { scope });
    const espacosDisponiveis = await listEspacosDisponiveis(pool, req.eventoId);
    const participantes = await listParticipantes(pool);
    const funilEtapas = await listFunilEtapas(pool, req.eventoId, { escopo: scope });
    res.json({
      items,
      espacosDisponiveis,
      resumo: summarizeArrecadacao(items, funilEtapas),
      participantes,
      funilEtapas,
      funilEscopo: scope,
    });
  } catch (err) {
    console.error('GET /api/arrecadacao', err);
    res.status(500).json({ error: 'Falha ao carregar arrecadação' });
  }
});

app.get('/api/funil-etapas', requireAuth, requireEvento, async (req, res) => {
  try {
    const escopo = String(req.query.escopo || 'comercial');
    const etapas = await listFunilEtapas(pool, req.eventoId, { escopo });
    res.json({ etapas, escopo });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/funil-etapas', err);
    res.status(500).json({ error: 'Falha ao carregar funil' });
  }
});

app.get('/api/funil-escopos', requireAuth, async (_req, res) => {
  res.json({ escopos: FUNIL_ESCOPOS });
});

app.put('/api/funil-etapas', requireAuth, requireEvento, async (req, res) => {
  try {
    const escopo = String(req.body?.escopo || 'comercial');
    const etapas = await saveFunilEtapas(pool, req.eventoId, req.body?.etapas, { escopo });
    res.json({ etapas, escopo });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/funil-etapas', err);
    res.status(500).json({ error: 'Falha ao salvar funil' });
  }
});

app.get('/api/tarefas-contato', requireAuth, requireEvento, async (req, res) => {
  try {
    const status = String(req.query.status || 'pendentes');
    const allowed = new Set(['pendentes', 'concluidas', 'todas']);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'Filtro de status inválido' });
    }
    const tarefas = await listTarefasContato(pool, req.eventoId, { status });
    res.json({ tarefas });
  } catch (err) {
    console.error('GET /api/tarefas-contato', err);
    res.status(500).json({ error: 'Falha ao carregar tarefas' });
  }
});

app.post('/api/tarefas-contato', requireAuth, requireEvento, async (req, res) => {
  try {
    const tarefa = await createTarefaContato(pool, req.eventoId, req.body);
    res.status(201).json({ tarefa });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/tarefas-contato', err);
    res.status(500).json({ error: 'Falha ao criar tarefa' });
  }
});

app.put('/api/tarefas-contato/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const tarefa = await updateTarefaContato(pool, id, req.body, req.eventoId);
    if (!tarefa) return res.status(404).json({ error: 'Tarefa não encontrada' });
    res.json({ tarefa });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/tarefas-contato/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar tarefa' });
  }
});

app.post('/api/tarefas-contato/:id/concluir', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const tarefa = await concluirTarefaContato(pool, id, req.eventoId);
    if (!tarefa) return res.status(404).json({ error: 'Tarefa não encontrada' });
    res.json({ tarefa });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/tarefas-contato/:id/concluir', err);
    res.status(500).json({ error: 'Falha ao concluir tarefa' });
  }
});

app.post('/api/arrecadacao', requireAuth, requireEvento, async (req, res) => {
  try {
    const item = await createPatrocinio(pool, req.eventoId, req.body);
    res.status(201).json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao', err);
    res.status(500).json({ error: 'Falha ao cadastrar patrocínio' });
  }
});

app.get('/api/arrecadacao/:id/interacoes', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const interacoes = await listInteracoes(pool, id);
    res.json({ interacoes });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id/interacoes', err);
    res.status(500).json({ error: 'Falha ao carregar interações' });
  }
});

app.get('/api/arrecadacao/:id/tarefas-contato', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const tarefas = await listTarefasContatoByArrecadacao(pool, id);
    res.json({ tarefas });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id/tarefas-contato', err);
    res.status(500).json({ error: 'Falha ao carregar tarefas do lead' });
  }
});

app.post('/api/arrecadacao/:id/interacoes', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const interacao = await createInteracao(pool, id, req.body);
    res.status(201).json({ interacao });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/interacoes', err);
    res.status(500).json({ error: 'Falha ao registrar interação' });
  }
});

app.get('/api/whatsapp/status', requireAuth, async (_req, res) => {
  try {
    const status = await getWhatsappStatus();
    res.json(status);
  } catch (err) {
    console.error('GET /api/whatsapp/status', err);
    res.status(500).json({ error: 'Falha ao consultar WhatsApp' });
  }
});

app.post('/api/whatsapp/connect', requireAuth, async (req, res) => {
  try {
    const result = await connectWhatsapp({ phone: req.body?.phone || req.body?.number });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/connect', err);
    res.status(500).json({ error: 'Falha ao conectar WhatsApp' });
  }
});

app.post('/api/whatsapp/disconnect', requireAuth, async (_req, res) => {
  try {
    const status = await disconnectWhatsapp();
    res.json(status);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/disconnect', err);
    res.status(500).json({ error: 'Falha ao desconectar WhatsApp' });
  }
});

app.get('/api/whatsapp/inbox', requireAuth, requireEvento, async (req, res) => {
  try {
    const threads = await listWhatsappInbox(pool, req.eventoId);
    const status = await getWhatsappStatusQuick(8000);
    res.json({ threads, status });
  } catch (err) {
    console.error('GET /api/whatsapp/inbox', err);
    res.status(500).json({ error: 'Falha ao carregar conversas' });
  }
});

app.get('/api/whatsapp/inbox/:participanteId/messages', requireAuth, requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }

    const mensagens = await listMessagesForParticipante(pool, req.eventoId, participanteId);
    res.json({ mensagens });
  } catch (err) {
    console.error('GET /api/whatsapp/inbox/:participanteId/messages', err);
    res.status(500).json({ error: 'Falha ao carregar mensagens' });
  }
});

app.post('/api/whatsapp/inbox/:participanteId/sync', requireAuth, requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }

    const days = Math.min(Math.max(Number(req.body?.days) || 14, 1), 30);
    const result = await syncInboxParticipante(pool, req.eventoId, participanteId, { days });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/inbox/:participanteId/sync', err);
    res.status(500).json({ error: 'Falha ao sincronizar conversa' });
  }
});

app.post('/api/whatsapp/inbox/:participanteId/messages/:mensagemId/reaction', requireAuth, requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    const mensagemId = Number(req.params.mensagemId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }
    if (!Number.isInteger(mensagemId) || mensagemId < 1) {
      return res.status(400).json({ error: 'Mensagem inválida' });
    }

    const result = await reactToWhatsappMessage(pool, mensagemId, req.body?.emoji, {
      eventoId: req.eventoId,
      participanteId,
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/inbox/:participanteId/messages/:mensagemId/reaction', err);
    res.status(500).json({ error: 'Falha ao reagir à mensagem' });
  }
});

app.post('/api/whatsapp/inbox/:participanteId/send', requireAuth, requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }
    const [rows] = await pool.query(
      `SELECT id FROM arrecadacao
       WHERE evento_id = ? AND participante_id = ?
       ORDER BY id ASC LIMIT 1`,
      [req.eventoId, participanteId],
    );
    const arrecadacaoId = rows[0]?.id ? Number(rows[0].id) : null;
    if (!arrecadacaoId) {
      return res.status(404).json({ error: 'Lead não encontrado para este participante' });
    }
    const { mensagem } = await sendWhatsappToLead(pool, arrecadacaoId, req.body?.text ?? req.body?.texto);
    res.status(201).json({ mensagem });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/inbox/:participanteId/send', err);
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

app.get('/api/whatsapp/media/:mensagemId', requireAuth, async (req, res) => {
  try {
    const mensagemId = Number(req.params.mensagemId);
    if (!Number.isInteger(mensagemId) || mensagemId < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    await streamWhatsappMensagemMedia(pool, mensagemId, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/whatsapp/media/:mensagemId', err);
    res.status(500).json({ error: 'Falha ao carregar mídia' });
  }
});

app.get('/api/arrecadacao/:id/whatsapp', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const [mensagens, status] = await Promise.all([
      listWhatsappMessages(pool, id),
      getWhatsappStatus(),
    ]);
    res.json({ mensagens, status });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id/whatsapp', err);
    res.status(500).json({ error: 'Falha ao carregar conversa WhatsApp' });
  }
});

app.post('/api/arrecadacao/:id/whatsapp/sync', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const result = await syncWhatsappHistory(pool, id, {
      days: Number(req.body?.days) || 5,
    });
    const mensagens = await listWhatsappMessages(pool, id);
    res.json({ ...result, mensagens });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/whatsapp/sync', err);
    res.status(500).json({ error: 'Falha ao sincronizar WhatsApp' });
  }
});

app.post('/api/arrecadacao/:id/whatsapp/messages/:mensagemId/reaction', requireAuth, async (req, res) => {
  try {
    const arrecadacaoId = Number(req.params.id);
    const mensagemId = Number(req.params.mensagemId);
    if (!Number.isInteger(arrecadacaoId) || arrecadacaoId < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    if (!Number.isInteger(mensagemId) || mensagemId < 1) {
      return res.status(400).json({ error: 'Mensagem inválida' });
    }
    const item = await findArrecadacaoById(pool, arrecadacaoId);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });

    const result = await reactToWhatsappMessage(pool, mensagemId, req.body?.emoji, { arrecadacaoId });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/whatsapp/messages/:mensagemId/reaction', err);
    res.status(500).json({ error: 'Falha ao reagir à mensagem' });
  }
});

app.post('/api/arrecadacao/:id/whatsapp/send', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const { mensagem } = await sendWhatsappToLead(pool, id, req.body?.text ?? req.body?.texto);
    res.status(201).json({ mensagem });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/whatsapp/send', err);
    res.status(500).json({ error: 'Falha ao enviar mensagem WhatsApp' });
  }
});

app.post('/api/webhooks/evolution', async (req, res) => {
  try {
    if (!validateWebhookSecret(req)) {
      return res.status(401).json({ error: 'Webhook não autorizado' });
    }
    const result = await handleEvolutionWebhook(pool, req.body);
    res.json(result);
  } catch (err) {
    console.error('POST /api/webhooks/evolution', err);
    res.status(500).json({ error: 'Falha ao processar webhook' });
  }
});

app.put('/api/arrecadacao/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await updateArrecadacao(pool, id, req.body);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/arrecadacao/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar arrecadação' });
  }
});

app.post('/api/arrecadacao/:id/migrar-artistico', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await migrateArrecadacaoToArtistico(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/migrar-artistico', err);
    res.status(500).json({ error: 'Falha ao migrar lead para artístico' });
  }
});

app.get('/api/arrecadacao/:id/pagamentos', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const pagamentos = await listPagamentosByArrecadacao(pool, id);
    res.json({ pagamentos });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id/pagamentos', err);
    res.status(500).json({ error: 'Falha ao carregar pagamentos' });
  }
});

app.delete('/api/arrecadacao/:id/pagamentos/:pagamentoId', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pagamentoId = Number(req.params.pagamentoId);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(pagamentoId) || pagamentoId < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const result = await deletePagamento(pool, id, pagamentoId, req.eventoId);
    if (!result) return res.status(404).json({ error: 'Pagamento não encontrado' });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/arrecadacao/:id/pagamentos/:pagamentoId', err);
    res.status(500).json({ error: 'Falha ao remover pagamento' });
  }
});

app.post('/api/arrecadacao/:id/pagamentos', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const result = await registerPagamento(pool, id, req.body);
    if (!result) return res.status(404).json({ error: 'Registro não encontrado' });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/pagamentos', err);
    res.status(500).json({ error: 'Falha ao registrar pagamento' });
  }
});

app.get('/api/participantes/:id/pagamentos', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const pagamentos = await listPagamentosByParticipante(pool, id);
    res.json({ pagamentos });
  } catch (err) {
    console.error('GET /api/participantes/:id/pagamentos', err);
    res.status(500).json({ error: 'Falha ao carregar histórico de pagamentos' });
  }
});

app.post('/api/arrecadacao/:id/perda-lead', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await registerPerdaLead(pool, id, req.body);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/perda-lead', err);
    res.status(500).json({ error: 'Falha ao registrar perda do lead' });
  }
});

app.delete('/api/arrecadacao/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const deleted = await deleteArrecadacao(pool, id);
    if (!deleted) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/arrecadacao/:id', err);
    res.status(500).json({ error: 'Falha ao excluir registro' });
  }
});

app.get('/api/marketing', requireAuth, requireEvento, async (req, res) => {
  try {
    const data = await listMarketingTree(pool, req.eventoId);
    res.json(data);
  } catch (err) {
    console.error('GET /api/marketing', err);
    res.status(500).json({ error: 'Falha ao carregar marketing' });
  }
});

app.post('/api/marketing/canais', requireAuth, requireEvento, async (req, res) => {
  try {
    const canal = await createMarketingCanal(pool, req.eventoId, req.body);
    res.status(201).json({ canal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/canais', err);
    res.status(500).json({ error: 'Falha ao criar origem' });
  }
});

app.put('/api/marketing/canais/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const canal = await updateMarketingCanal(pool, id, req.eventoId, req.body);
    if (!canal) return res.status(404).json({ error: 'Origem não encontrada' });
    res.json({ canal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/marketing/canais/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar origem' });
  }
});

app.delete('/api/marketing/canais/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteMarketingCanal(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Origem não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/marketing/canais/:id', err);
    res.status(500).json({ error: 'Falha ao excluir origem' });
  }
});

app.post('/api/marketing/campanhas', requireAuth, requireEvento, async (req, res) => {
  try {
    const campanha = await createMarketingCampanha(pool, req.eventoId, req.body);
    res.status(201).json({ campanha });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/campanhas', err);
    res.status(500).json({ error: 'Falha ao criar campanha' });
  }
});

app.put('/api/marketing/campanhas/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const campanha = await updateMarketingCampanha(pool, id, req.eventoId, req.body);
    if (!campanha) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ campanha });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/marketing/campanhas/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar campanha' });
  }
});

app.delete('/api/marketing/campanhas/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteMarketingCampanha(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/marketing/campanhas/:id', err);
    res.status(500).json({ error: 'Falha ao excluir campanha' });
  }
});

app.post('/api/marketing/criativos', requireAuth, requireEvento, async (req, res) => {
  try {
    const criativo = await createMarketingCriativo(pool, req.eventoId, req.body);
    res.status(201).json({ criativo });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/criativos', err);
    res.status(500).json({ error: 'Falha ao criar criativo' });
  }
});

app.put('/api/marketing/criativos/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const criativo = await updateMarketingCriativo(pool, id, req.eventoId, req.body);
    if (!criativo) return res.status(404).json({ error: 'Criativo não encontrado' });
    res.json({ criativo });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/marketing/criativos/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar criativo' });
  }
});

app.delete('/api/marketing/criativos/:id', requireAuth, requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteMarketingCriativo(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Criativo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/marketing/criativos/:id', err);
    res.status(500).json({ error: 'Falha ao excluir criativo' });
  }
});

app.get('/api/users', requireAuth, async (_req, res) => {
  try {
    const users = await listUsers(pool);
    res.json({ users });
  } catch (err) {
    console.error('GET /api/users', err);
    res.status(500).json({ error: 'Falha ao carregar usuários' });
  }
});

app.post('/api/users', requireAuth, async (req, res) => {
  try {
    const input = normalizeUserInput(req.body, { requirePassword: true });
    const passwordHash = await hashPassword(input.password);
    const user = await createUser(pool, { ...input, passwordHash });
    res.status(201).json({ user: publicUserRow(user) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'E-mail ou celular já cadastrado' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/users', err);
    res.status(500).json({ error: 'Falha ao criar usuário' });
  }
});

app.put('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const existing = await findUserById(pool, id);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });

    const input = normalizeUserInput(req.body, { requirePassword: false });
    let passwordHash = null;
    if (input.password.trim()) {
      passwordHash = await hashPassword(input.password);
    }

    const user = await updateUser(pool, id, { ...input, passwordHash });
    res.json({ user: publicUserRow(user) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'E-mail ou celular já cadastrado' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/users/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar usuário' });
  }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário' });
    }

    const total = await countUsers(pool);
    if (total <= 1) {
      return res.status(400).json({ error: 'Não é possível excluir o último usuário' });
    }

    const deleted = await deleteUser(pool, id);
    if (!deleted) return res.status(404).json({ error: 'Usuário não encontrado' });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/:id', err);
    res.status(500).json({ error: 'Falha ao excluir usuário' });
  }
});

app.post('/api/grupos/:slug/espacos/:numero/mover', requireAuth, requireEvento, async (req, res) => {
  try {
    const destinoNumero = req.body?.destinoNumero;
    if (destinoNumero == null) {
      return res.status(400).json({ error: 'Campo destinoNumero é obrigatório' });
    }

    await moveEspacoReserva(
      pool,
      req.params.slug,
      req.params.numero,
      req.body,
      req.eventoId,
    );
    await ensureTiposComercio(pool, [req.body?.tipo]);
    const result = await fetchSpacesByGrupo(pool, req.params.slug, req.eventoId);
    const tipos = await fetchTiposComercio(pool);
    const participantes = await listParticipantes(pool);
    res.json({ ...result, tipos, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/grupos/:slug/espacos/:numero/mover', err);
    res.status(500).json({ error: 'Falha ao mover reserva de espaço' });
  }
});

app.put('/api/grupos/:slug/espacos', requireAuth, requireEvento, async (req, res) => {
  try {
    const updates = req.body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Campo updates é obrigatório' });
    }

    await upsertSpaces(pool, req.params.slug, updates, req.eventoId);
    await ensureTiposComercio(
      pool,
      updates.map((u) => u.tipo),
    );
    const result = await fetchSpacesByGrupo(pool, req.params.slug, req.eventoId);
    const tipos = await fetchTiposComercio(pool);
    const participantes = await listParticipantes(pool);
    res.json({ ...result, tipos, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/grupos/:slug/espacos', err);
    res.status(500).json({ error: 'Falha ao salvar espaços' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota ${req.method} ${req.originalUrl} não encontrada` });
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

async function start() {
  await migrateParticipantes(pool);
  await migrateEventos(pool);
  await migrateEspacos(pool);
  await migrateArrecadacao(pool);
  await migrateTarefas(pool);
  await migrateFunil(pool);
  await migrateInteracoes(pool);
  await migrateMarketing(pool);
  await migrateWhatsapp(pool);
  await migrateSeguidoresHistorico(pool);
  await migrateTiposComercio(pool);
  await migrateUsers(pool);

  const server = http.createServer(app);
  attachWhatsappWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Opalapa Gestão rodando na porta ${PORT}`);
  });

  syncAllArrecadacaoFromEspacos(pool).catch((err) => {
    console.error('Falha ao sincronizar arrecadação dos espaços:', err);
  });

  const publicUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  const { enabled } = getEvolutionConfig();
  if (enabled && publicUrl) {
    const webhookUrl = `${publicUrl}/api/webhooks/evolution`;
    configureInstanceWebhook(webhookUrl, process.env.EVOLUTION_WEBHOOK_SECRET || '')
      .then(() => console.log(`Webhook Evolution configurado: ${webhookUrl}`))
      .catch((err) => {
        const detail = err.body ? JSON.stringify(err.body) : err.message;
        console.warn('Não foi possível configurar webhook Evolution:', detail);
      });
  }
}

start().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});
