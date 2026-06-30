import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool, formatDatabaseStartupError } from './db.js';
import { migrateEspacos, fetchSpacesByGrupo, upsertSpaces, moveEspacoReserva, moveEspacosReservas } from './espacos.js';
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
  findArrecadacaoByEspacoId,
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
  migrateProducaoCronologia,
  listProducaoCronologia,
  createProducaoCronologia,
  updateProducaoCronologia,
  deleteProducaoCronologia,
} from './producao-cronologia.js';
import {
  migrateProducaoPremiacoes,
  listProducaoPremiacoes,
  createProducaoPremiacao,
  updateProducaoPremiacao,
  deleteProducaoPremiacao,
} from './producao-premiacoes.js';
import {
  migrateFinanceiroResultado,
  listFinanceiroResultado,
  createFinanceiroLinha,
  updateFinanceiroLinha,
  deleteFinanceiroLinha,
  clearFinanceiroResultado,
  carregarModeloFinanceiroResultado,
  patchSumarioArrecadacaoPrevisto,
  patchFaturamentoPracaAlimentacao,
} from './financeiro-resultado.js';
import { buildFinanceiroPainel } from './financeiro-painel.js';
import {
  listVendasHora,
  patchVendaHora,
  carregarModeloVendasHora,
} from './financeiro-vendas-hora.js';
import { listBebidas, patchBebida, carregarModeloBebidas } from './financeiro-bebidas.js';
import {
  migrateFinanceiroContasPagar,
  listFinanceiroCategorias,
  createFinanceiroCategoria,
  listFinanceiroPlanoContas,
  createFinanceiroPlanoConta,
  updateFinanceiroCategoria,
  deleteFinanceiroCategoria,
  updateFinanceiroPlanoConta,
  deleteFinanceiroPlanoConta,
  listContasPagar,
  findContaPagarById,
  createContaPagar,
  updateContaPagar,
  deleteContaPagar,
  bulkUpdateContasPagar,
  bulkUpdateContasPagarFase,
  summarizeContasPagar,
} from './financeiro-contas-pagar.js';
import {
  migrateWhatsapp,
  listWhatsappMessages,
  syncWhatsappHistory,
  sendWhatsappOutbound,
  handleEvolutionWebhook,
  getWhatsappStatus,
  getWhatsappStatusQuick,
  connectWhatsapp,
  disconnectWhatsapp,
  validateWebhookSecret,
  reactToWhatsappMessage,
  startWhatsappMediaWorker,
  runWhatsappMediaBackfill,
} from './whatsapp.js';
import {
  listWhatsappInbox,
  listMessagesForParticipante,
  getWhatsappInboxThread,
  syncInboxParticipante,
  prepareWhatsappConversation,
  getPrimaryArrecadacaoId,
} from './whatsapp-inbox.js';
import { attachWhatsappWebSocket } from './whatsapp-ws.js';
import { configureInstanceWebhook, getEvolutionConfig } from './evolution.js';
import { streamWhatsappMensagemMedia, attachMediaTokensToMensagens, attachMediaTokenToMensagem } from './whatsapp-media.js';
import { attachAvatarUrlsToThreads, streamWhatsappAvatar, syncStaleParticipantAvatars, attachAvatarUrlsToParticipantes } from './whatsapp-avatars.js';
import { fetchLinkPreview } from './link-preview.js';
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
  authorizeWhatsappMedia,
  authorizeWhatsappAvatar,
  publicUser,
} from './auth.js';
import {
  migrateAuthOtp,
  sendAuthOtp,
  verifySmsLogin,
  verifyPasswordResetOtp,
} from './auth-otp.js';
import {
  migratePermissions,
  PERMISSION_CATALOG,
  listPermissionGroups,
  findPermissionGroupById,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  getUserAccess,
  getDefaultPermissionGroupId,
  isPublicApiRoute,
  loadUserPermissions,
  enforceApiPermission,
  buildPublicAccess,
} from './permissions.js';

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

const jsonDefault = express.json({ limit: '1mb' });
const jsonWhatsappMedia = express.json({ limit: '16mb' });

function isWhatsappMediaSendPath(pathname) {
  return (
    /^\/api\/whatsapp\/inbox\/\d+\/send$/.test(pathname) ||
    /^\/api\/arrecadacao\/\d+\/whatsapp\/send$/.test(pathname)
  );
}

app.use((req, res, next) => {
  if (isWhatsappMediaSendPath(req.path)) {
    return jsonWhatsappMedia(req, res, next);
  }
  return jsonDefault(req, res, next);
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (isPublicApiRoute(req)) return next();
  requireAuth(req, res, () => {
    loadUserPermissions(pool)(req, res, () => {
      enforceApiPermission(req, res, next);
    });
  });
});

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
    const access = await getUserAccess(pool, user.id);
    res.json({ user: { ...publicUser(user), ...buildPublicAccess(user, access) } });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: 'Falha ao entrar' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await findUserById(pool, req.user.id);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    const access = await getUserAccess(pool, user.id);
    res.json({ user: publicUserRow(user, access) });
  } catch (err) {
    console.error('GET /api/auth/me', err);
    res.status(500).json({ error: 'Falha ao validar sessão' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

async function issueUserSession(res, user) {
  const token = signToken(user);
  setSessionCookie(res, token);
  const access = await getUserAccess(pool, user.id);
  return { user: { ...publicUser(user), ...buildPublicAccess(user, access) } };
}

app.post('/api/auth/otp/send', async (req, res) => {
  try {
    const result = await sendAuthOtp(pool, {
      login: req.body?.login,
      purpose: req.body?.purpose,
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/otp/send', err);
    res.status(500).json({ error: 'Falha ao enviar código' });
  }
});

app.post('/api/auth/otp/verify-login', async (req, res) => {
  try {
    const user = await verifySmsLogin(pool, {
      login: req.body?.login,
      code: req.body?.code,
    });
    const sessionUser = await findUserById(pool, user.id);
    if (!sessionUser) return res.status(404).json({ error: 'Usuário não encontrado' });
    const payload = await issueUserSession(res, sessionUser);
    res.json(payload);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/otp/verify-login', err);
    res.status(500).json({ error: 'Falha ao validar código' });
  }
});

app.post('/api/auth/password/reset', async (req, res) => {
  try {
    const login = req.body?.login;
    const code = req.body?.code;
    const password = req.body?.password;

    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
    }

    const verified = await verifyPasswordResetOtp(pool, { login, code });
    const sessionUser = await findUserById(pool, verified.id);
    if (!sessionUser) return res.status(404).json({ error: 'Usuário não encontrado' });

    const passwordHash = await hashPassword(password);
    await updateUser(pool, verified.id, {
      name: sessionUser.name,
      email: sessionUser.email,
      phone: sessionUser.phone,
      passwordHash,
      permissionGroupId: sessionUser.permissionGroupId,
    });

    const updatedUser = await findUserById(pool, verified.id);
    const payload = await issueUserSession(res, updatedUser);
    res.json(payload);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/password/reset', err);
    res.status(500).json({ error: 'Falha ao redefinir senha' });
  }
});

app.get('/api/tipos-comercio', async (_req, res) => {
  try {
    const tipos = await fetchTiposComercio(pool);
    res.json({ tipos });
  } catch (err) {
    console.error('GET /api/tipos-comercio', err);
    res.status(500).json({ error: 'Falha ao carregar tipos de comércio' });
  }
});

app.get('/api/eventos', async (_req, res) => {
  try {
    const eventos = await listEventos(pool);
    res.json({ eventos });
  } catch (err) {
    console.error('GET /api/eventos', err);
    res.status(500).json({ error: 'Falha ao carregar eventos' });
  }
});

app.post('/api/eventos', async (req, res) => {
  try {
    const evento = await createEvento(pool, req.body);
    res.status(201).json({ evento });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/eventos', err);
    res.status(500).json({ error: 'Falha ao criar evento' });
  }
});

app.put('/api/eventos/:id', async (req, res) => {
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

app.delete('/api/eventos/:id', async (req, res) => {
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

app.get('/api/eventos/:id/comparacao', async (req, res) => {
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

app.get('/api/grupos', requireEvento, async (req, res) => {
  try {
    const grupos = await fetchGrupos(pool, req.eventoId);
    res.json({ grupos });
  } catch (err) {
    console.error('GET /api/grupos', err);
    res.status(500).json({ error: 'Falha ao carregar agrupamentos' });
  }
});

app.get('/api/grupos/:slug/espacos', requireEvento, async (req, res) => {
  try {
    const result = await fetchSpacesByGrupo(pool, req.params.slug, req.eventoId);
    const participantes = attachAvatarUrlsToParticipantes(
      await listParticipantes(pool),
      req.eventoId,
    );
    res.json({ ...result, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/grupos/:slug/espacos', err);
    res.status(500).json({ error: 'Falha ao carregar espaços' });
  }
});

app.get('/api/participantes', async (req, res) => {
  try {
    const eventoId = Number(req.headers['x-evento-id']);
    let participantes = await listParticipantes(pool);
    if (Number.isInteger(eventoId) && eventoId > 0) {
      participantes = attachAvatarUrlsToParticipantes(participantes, eventoId);
    }
    res.json({ participantes });
  } catch (err) {
    console.error('GET /api/participantes', err);
    res.status(500).json({ error: 'Falha ao carregar participantes' });
  }
});

app.post('/api/participantes', async (req, res) => {
  try {
    const participante = await createParticipante(pool, req.body);
    res.status(201).json({ participante });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/participantes', err);
    res.status(500).json({ error: 'Falha ao criar participante' });
  }
});

app.put('/api/participantes/:id', async (req, res) => {
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

app.get('/api/participantes/:id/seguidores-historico', async (req, res) => {
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

app.delete('/api/participantes/:id', requireEvento, async (req, res) => {
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

app.get('/api/espacos-disponiveis', requireEvento, async (req, res) => {
  try {
    const espacos = await listEspacosDisponiveis(pool, req.eventoId);
    res.json({ espacos });
  } catch (err) {
    console.error('GET /api/espacos-disponiveis', err);
    res.status(500).json({ error: 'Falha ao carregar espaços disponíveis' });
  }
});

app.get('/api/arrecadacao', requireEvento, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'comercial');
    const allowedScopes = new Set(['comercial', 'artistico']);
    if (!allowedScopes.has(scope)) {
      return res.status(400).json({ error: 'Escopo inválido' });
    }
    const items = await listArrecadacao(pool, req.eventoId, { scope });
    const espacosDisponiveis = await listEspacosDisponiveis(pool, req.eventoId);
    const participantes = attachAvatarUrlsToParticipantes(
      await listParticipantes(pool),
      req.eventoId,
    );
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

app.get('/api/arrecadacao/by-espaco/:espacoId', requireEvento, async (req, res) => {
  try {
    const espacoId = Number(req.params.espacoId);
    if (!Number.isInteger(espacoId) || espacoId < 1) {
      return res.status(400).json({ error: 'Espaço inválido' });
    }
    const [spaceRows] = await pool.query(
      `SELECT e.id FROM espacos e
       JOIN grupos_espacos g ON g.id = e.grupo_id
       WHERE e.id = ? AND g.evento_id = ?
       LIMIT 1`,
      [espacoId, req.eventoId],
    );
    if (!spaceRows[0]) return res.status(404).json({ error: 'Espaço não encontrado neste evento' });
    const item = await findArrecadacaoByEspacoId(pool, espacoId);
    if (!item) return res.status(404).json({ error: 'Lead não vinculado a este espaço' });
    res.json({ item });
  } catch (err) {
    console.error('GET /api/arrecadacao/by-espaco/:espacoId', err);
    res.status(500).json({ error: 'Falha ao carregar lead do espaço' });
  }
});

app.get('/api/arrecadacao/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const [check] = await pool.query(
      'SELECT id FROM arrecadacao WHERE id = ? AND evento_id = ? LIMIT 1',
      [id, req.eventoId],
    );
    if (!check[0]) return res.status(404).json({ error: 'Lead não encontrado neste evento' });
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json({ item });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id', err);
    res.status(500).json({ error: 'Falha ao carregar lead' });
  }
});

app.get('/api/funil-etapas', requireEvento, async (req, res) => {
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

app.get('/api/funil-escopos', async (_req, res) => {
  res.json({ escopos: FUNIL_ESCOPOS });
});

app.put('/api/funil-etapas', requireEvento, async (req, res) => {
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

app.get('/api/tarefas-contato', requireEvento, async (req, res) => {
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

app.post('/api/tarefas-contato', requireEvento, async (req, res) => {
  try {
    const tarefa = await createTarefaContato(pool, req.eventoId, req.body);
    res.status(201).json({ tarefa });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/tarefas-contato', err);
    res.status(500).json({ error: 'Falha ao criar tarefa' });
  }
});

app.put('/api/tarefas-contato/:id', requireEvento, async (req, res) => {
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

app.post('/api/tarefas-contato/:id/concluir', requireEvento, async (req, res) => {
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

app.post('/api/arrecadacao', requireEvento, async (req, res) => {
  try {
    const item = await createPatrocinio(pool, req.eventoId, req.body);
    res.status(201).json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao', err);
    res.status(500).json({ error: 'Falha ao cadastrar patrocínio' });
  }
});

app.get('/api/arrecadacao/:id/interacoes', async (req, res) => {
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

app.get('/api/arrecadacao/:id/tarefas-contato', async (req, res) => {
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

app.post('/api/arrecadacao/:id/interacoes', async (req, res) => {
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

app.get('/api/whatsapp/status', async (_req, res) => {
  try {
    const status = await getWhatsappStatus();
    res.json(status);
  } catch (err) {
    console.error('GET /api/whatsapp/status', err);
    res.status(500).json({ error: 'Falha ao consultar WhatsApp' });
  }
});

app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    const result = await connectWhatsapp({ phone: req.body?.phone || req.body?.number });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/connect', err);
    res.status(500).json({ error: 'Falha ao conectar WhatsApp' });
  }
});

app.post('/api/whatsapp/disconnect', async (_req, res) => {
  try {
    const status = await disconnectWhatsapp();
    res.json(status);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/disconnect', err);
    res.status(500).json({ error: 'Falha ao desconectar WhatsApp' });
  }
});

app.get('/api/link-preview', async (req, res) => {
  try {
    const preview = await fetchLinkPreview(req.query.url);
    res.json(preview);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/link-preview', err);
    res.status(500).json({ error: 'Falha ao carregar prévia do link' });
  }
});

app.get('/api/whatsapp/inbox', requireEvento, async (req, res) => {
  try {
    const threads = attachAvatarUrlsToThreads(
      await listWhatsappInbox(pool, req.eventoId),
      req.eventoId,
    );
    const status = await getWhatsappStatusQuick(8000);
    res.json({ threads, status });
    void syncStaleParticipantAvatars(pool, req.eventoId).catch((err) => {
      console.warn('syncStaleParticipantAvatars:', err.message);
    });
  } catch (err) {
    console.error('GET /api/whatsapp/inbox', err);
    res.status(500).json({ error: 'Falha ao carregar conversas' });
  }
});

app.get('/api/whatsapp/avatar/:participanteId', authorizeWhatsappAvatar, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    await streamWhatsappAvatar(pool, req.eventoId, participanteId, res);
  } catch (err) {
    if (err.status === 404) return res.status(404).end();
    console.error('GET /api/whatsapp/avatar/:participanteId', err);
    res.status(err.status || 500).json({ error: err.message || 'Falha ao carregar avatar' });
  }
});

app.get('/api/whatsapp/inbox/:participanteId', requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }
    const thread = attachAvatarUrlsToThreads(
      [await getWhatsappInboxThread(pool, req.eventoId, participanteId)].filter(Boolean),
      req.eventoId,
    )[0];
    if (!thread) {
      return res.status(404).json({
        error: 'Contato sem WhatsApp cadastrado.',
      });
    }
    res.json({ thread });
  } catch (err) {
    console.error('GET /api/whatsapp/inbox/:participanteId', err);
    res.status(500).json({ error: 'Falha ao carregar conversa' });
  }
});

app.get('/api/whatsapp/inbox/:participanteId/messages', requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }

    const prepare = req.query.prepare !== '0' && req.query.prepare !== 'false';
    const mensagens = attachMediaTokensToMensagens(
      await listMessagesForParticipante(pool, req.eventoId, participanteId, { prepare }),
    );
    res.json({ mensagens });
  } catch (err) {
    console.error('GET /api/whatsapp/inbox/:participanteId/messages', err);
    res.status(500).json({ error: 'Falha ao carregar mensagens' });
  }
});

app.post('/api/whatsapp/inbox/:participanteId/sync', requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }

    const days = Math.min(Math.max(Number(req.body?.days) || 5, 1), 30);
    const result = await syncInboxParticipante(pool, req.eventoId, participanteId, { days });
    res.json({ ...result, mensagens: attachMediaTokensToMensagens(result.mensagens) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/inbox/:participanteId/sync', err);
    res.status(500).json({ error: 'Falha ao sincronizar conversa' });
  }
});

app.post('/api/whatsapp/inbox/:participanteId/messages/:mensagemId/reaction', requireEvento, async (req, res) => {
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

app.post('/api/whatsapp/inbox/:participanteId/send', requireEvento, async (req, res) => {
  try {
    const participanteId = Number(req.params.participanteId);
    if (!Number.isInteger(participanteId) || participanteId < 1) {
      return res.status(400).json({ error: 'Participante inválido' });
    }
    const arrecadacaoId = await getPrimaryArrecadacaoId(pool, req.eventoId, participanteId);
    if (!arrecadacaoId) {
      return res.status(404).json({ error: 'Lead não encontrado para este participante' });
    }
    const { mensagem } = await sendWhatsappOutbound(pool, arrecadacaoId, req.body);
    res.status(201).json({ mensagem: attachMediaTokenToMensagem(mensagem) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/whatsapp/inbox/:participanteId/send', err);
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

app.get('/api/whatsapp/media/:mensagemId', authorizeWhatsappMedia, async (req, res) => {
  try {
    const mensagemId = Number(req.params.mensagemId);
    await streamWhatsappMensagemMedia(pool, mensagemId, res, {
      preview: req.query.preview === '1',
      req,
    });
  } catch (err) {
    if (res.headersSent || res.writableEnded) {
      console.warn(`GET /api/whatsapp/media/${req.params.mensagemId} (resposta já enviada):`, err.message);
      return;
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/whatsapp/media/:mensagemId', err);
    res.status(500).json({ error: 'Falha ao carregar mídia' });
  }
});

app.get('/api/arrecadacao/:id/whatsapp', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const prepare = req.query.prepare === '1' || req.query.prepare === 'true';
    const status = await getWhatsappStatus();
    if (prepare) {
      const prepared = await prepareWhatsappConversation(pool, { arrecadacaoId: id, days: 7 });
      const mensagens = attachMediaTokensToMensagens(await listWhatsappMessages(pool, id));
      return res.json({ mensagens, status, prepared });
    }
    const mensagens = attachMediaTokensToMensagens(await listWhatsappMessages(pool, id));
    res.json({ mensagens, status });
  } catch (err) {
    console.error('GET /api/arrecadacao/:id/whatsapp', err);
    res.status(500).json({ error: 'Falha ao carregar conversa WhatsApp' });
  }
});

app.post('/api/arrecadacao/:id/whatsapp/sync', async (req, res) => {
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
    const mensagens = attachMediaTokensToMensagens(await listWhatsappMessages(pool, id));
    res.json({ ...result, mensagens });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao/:id/whatsapp/sync', err);
    res.status(500).json({ error: 'Falha ao sincronizar WhatsApp' });
  }
});

app.post('/api/arrecadacao/:id/whatsapp/messages/:mensagemId/reaction', async (req, res) => {
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

app.post('/api/arrecadacao/:id/whatsapp/send', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const item = await findArrecadacaoById(pool, id);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    const { mensagem } = await sendWhatsappOutbound(pool, id, req.body);
    res.status(201).json({ mensagem: attachMediaTokenToMensagem(mensagem) });
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

app.put('/api/arrecadacao/:id', async (req, res) => {
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

app.post('/api/arrecadacao/:id/migrar-artistico', async (req, res) => {
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

app.get('/api/arrecadacao/:id/pagamentos', requireEvento, async (req, res) => {
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

app.delete('/api/arrecadacao/:id/pagamentos/:pagamentoId', requireEvento, async (req, res) => {
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

app.post('/api/arrecadacao/:id/pagamentos', requireEvento, async (req, res) => {
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

app.get('/api/participantes/:id/pagamentos', async (req, res) => {
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

app.post('/api/arrecadacao/:id/perda-lead', async (req, res) => {
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

app.delete('/api/arrecadacao/:id', async (req, res) => {
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

app.get('/api/marketing', requireEvento, async (req, res) => {
  try {
    const data = await listMarketingTree(pool, req.eventoId);
    res.json(data);
  } catch (err) {
    console.error('GET /api/marketing', err);
    res.status(500).json({ error: 'Falha ao carregar marketing' });
  }
});

app.post('/api/marketing/canais', requireEvento, async (req, res) => {
  try {
    const canal = await createMarketingCanal(pool, req.eventoId, req.body);
    res.status(201).json({ canal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/canais', err);
    res.status(500).json({ error: 'Falha ao criar origem' });
  }
});

app.put('/api/marketing/canais/:id', requireEvento, async (req, res) => {
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

app.delete('/api/marketing/canais/:id', requireEvento, async (req, res) => {
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

app.post('/api/marketing/campanhas', requireEvento, async (req, res) => {
  try {
    const campanha = await createMarketingCampanha(pool, req.eventoId, req.body);
    res.status(201).json({ campanha });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/campanhas', err);
    res.status(500).json({ error: 'Falha ao criar campanha' });
  }
});

app.put('/api/marketing/campanhas/:id', requireEvento, async (req, res) => {
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

app.delete('/api/marketing/campanhas/:id', requireEvento, async (req, res) => {
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

app.post('/api/marketing/criativos', requireEvento, async (req, res) => {
  try {
    const criativo = await createMarketingCriativo(pool, req.eventoId, req.body);
    res.status(201).json({ criativo });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/marketing/criativos', err);
    res.status(500).json({ error: 'Falha ao criar criativo' });
  }
});

app.put('/api/marketing/criativos/:id', requireEvento, async (req, res) => {
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

app.delete('/api/marketing/criativos/:id', requireEvento, async (req, res) => {
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

app.get('/api/producao/cronologia', requireEvento, async (req, res) => {
  try {
    const data = await listProducaoCronologia(pool, req.eventoId);
    res.json(data);
  } catch (err) {
    console.error('GET /api/producao/cronologia', err);
    res.status(500).json({ error: 'Falha ao carregar cronologia' });
  }
});

app.post('/api/producao/cronologia', requireEvento, async (req, res) => {
  try {
    const item = await createProducaoCronologia(pool, req.eventoId, req.body);
    res.status(201).json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/producao/cronologia', err);
    res.status(500).json({ error: 'Falha ao criar registro' });
  }
});

app.put('/api/producao/cronologia/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await updateProducaoCronologia(pool, id, req.eventoId, req.body);
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/producao/cronologia/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar registro' });
  }
});

app.delete('/api/producao/cronologia/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteProducaoCronologia(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/producao/cronologia/:id', err);
    res.status(500).json({ error: 'Falha ao excluir registro' });
  }
});

app.get('/api/producao/premiacoes', requireEvento, async (req, res) => {
  try {
    const data = await listProducaoPremiacoes(pool, req.eventoId);
    res.json(data);
  } catch (err) {
    console.error('GET /api/producao/premiacoes', err);
    res.status(500).json({ error: 'Falha ao carregar premiações' });
  }
});

app.post('/api/producao/premiacoes', requireEvento, async (req, res) => {
  try {
    const item = await createProducaoPremiacao(pool, req.eventoId, req.body);
    res.status(201).json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/producao/premiacoes', err);
    res.status(500).json({ error: 'Falha ao criar prêmio' });
  }
});

app.put('/api/producao/premiacoes/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await updateProducaoPremiacao(pool, id, req.eventoId, req.body);
    if (!item) return res.status(404).json({ error: 'Prêmio não encontrado' });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/producao/premiacoes/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar prêmio' });
  }
});

app.delete('/api/producao/premiacoes/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteProducaoPremiacao(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Prêmio não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/producao/premiacoes/:id', err);
    res.status(500).json({ error: 'Falha ao excluir prêmio' });
  }
});

app.get('/api/financeiro/categorias', requireEvento, async (req, res) => {
  try {
    const gestao = req.query.gestao === '1' || req.query.gestao === 'true';
    const categorias = await listFinanceiroCategorias(pool, req.eventoId, { gestao });
    res.json({ categorias });
  } catch (err) {
    console.error('GET /api/financeiro/categorias', err);
    res.status(500).json({ error: 'Falha ao carregar categorias' });
  }
});

app.post('/api/financeiro/categorias', requireEvento, async (req, res) => {
  try {
    const categoria = await createFinanceiroCategoria(pool, req.eventoId, req.body);
    res.status(201).json({ categoria });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/categorias', err);
    res.status(500).json({ error: 'Falha ao criar categoria' });
  }
});

app.put('/api/financeiro/categorias/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const categoria = await updateFinanceiroCategoria(pool, id, req.eventoId, req.body);
    if (!categoria) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json({ categoria });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/financeiro/categorias/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar categoria' });
  }
});

app.delete('/api/financeiro/categorias/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteFinanceiroCategoria(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/financeiro/categorias/:id', err);
    res.status(500).json({ error: 'Falha ao excluir categoria' });
  }
});

app.get('/api/financeiro/plano-contas', requireEvento, async (req, res) => {
  try {
    const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;
    const gestao = req.query.gestao === '1' || req.query.gestao === 'true';
    const planoContas = await listFinanceiroPlanoContas(pool, req.eventoId, { categoriaId, gestao });
    res.json({ planoContas });
  } catch (err) {
    console.error('GET /api/financeiro/plano-contas', err);
    res.status(500).json({ error: 'Falha ao carregar plano de contas' });
  }
});

app.post('/api/financeiro/plano-contas', requireEvento, async (req, res) => {
  try {
    const conta = await createFinanceiroPlanoConta(pool, req.eventoId, req.body);
    res.status(201).json({ conta });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/plano-contas', err);
    res.status(500).json({ error: 'Falha ao criar conta contábil' });
  }
});

app.put('/api/financeiro/plano-contas/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conta = await updateFinanceiroPlanoConta(pool, id, req.eventoId, req.body);
    if (!conta) return res.status(404).json({ error: 'Plano de contas não encontrado' });
    res.json({ conta });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/financeiro/plano-contas/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar plano de contas' });
  }
});

app.delete('/api/financeiro/plano-contas/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteFinanceiroPlanoConta(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Plano de contas não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/financeiro/plano-contas/:id', err);
    res.status(500).json({ error: 'Falha ao excluir plano de contas' });
  }
});

app.get('/api/financeiro/contas-pagar', requireEvento, async (req, res) => {
  try {
    const contas = await listContasPagar(pool, req.eventoId);
    const { totais } = summarizeContasPagar(contas);
    res.json({ contas, totais });
  } catch (err) {
    console.error('GET /api/financeiro/contas-pagar', err);
    res.status(500).json({ error: 'Falha ao carregar contas a pagar' });
  }
});

app.post('/api/financeiro/contas-pagar', requireEvento, async (req, res) => {
  try {
    const conta = await createContaPagar(pool, req.eventoId, req.body);
    res.status(201).json({ conta });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/contas-pagar', err);
    res.status(500).json({ error: 'Falha ao criar conta a pagar' });
  }
});

app.patch('/api/financeiro/contas-pagar/fase', requireEvento, async (req, res) => {
  try {
    const result = await bulkUpdateContasPagarFase(pool, req.eventoId, req.body);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/contas-pagar/fase', err);
    res.status(500).json({ error: 'Falha ao atualizar fase das contas' });
  }
});

app.patch('/api/financeiro/contas-pagar/bulk', requireEvento, async (req, res) => {
  try {
    const result = await bulkUpdateContasPagar(pool, req.eventoId, req.body);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/contas-pagar/bulk', err);
    res.status(500).json({ error: 'Falha na alteração em massa das contas' });
  }
});

app.put('/api/financeiro/contas-pagar/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conta = await updateContaPagar(pool, id, req.eventoId, req.body);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ conta });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/financeiro/contas-pagar/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar conta a pagar' });
  }
});

app.delete('/api/financeiro/contas-pagar/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteContaPagar(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/financeiro/contas-pagar/:id', err);
    res.status(500).json({ error: 'Falha ao excluir conta a pagar' });
  }
});

app.get('/api/financeiro/painel', requireEvento, async (req, res) => {
  try {
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ painel });
  } catch (err) {
    console.error('GET /api/financeiro/painel', err);
    res.status(500).json({ error: 'Falha ao carregar painel financeiro' });
  }
});

app.patch('/api/financeiro/sumario-arrecadacao', requireEvento, async (req, res) => {
  try {
    const chave = String(req.body?.chave || '').trim();
    const { previsto } = req.body ?? {};
    if (!chave) return res.status(400).json({ error: 'Informe a categoria do sumário' });
    const result = await patchSumarioArrecadacaoPrevisto(pool, req.eventoId, chave, previsto);
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    const sumarioLinha = painel.sumarioArrecadacao?.linhas?.find((l) => l.id === chave) || null;
    res.json({ ...result, sumarioLinha, sumarioArrecadacao: painel.sumarioArrecadacao, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/sumario-arrecadacao', err);
    res.status(500).json({ error: 'Falha ao salvar previsto do sumário' });
  }
});

app.get('/api/financeiro/vendas-hora', requireEvento, async (req, res) => {
  try {
    const vendasHora = await listVendasHora(pool, req.eventoId);
    res.json({ vendasHora });
  } catch (err) {
    console.error('GET /api/financeiro/vendas-hora', err);
    res.status(500).json({ error: 'Falha ao carregar vendas na hora' });
  }
});

app.patch('/api/financeiro/vendas-hora/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await patchVendaHora(pool, id, req.eventoId, req.body);
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    const vendasHora = await listVendasHora(pool, req.eventoId);
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ item, vendasHora, sumarioArrecadacao: painel.sumarioArrecadacao, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/vendas-hora/:id', err);
    res.status(500).json({ error: 'Falha ao salvar item de venda' });
  }
});

app.post('/api/financeiro/vendas-hora/carregar-modelo', requireEvento, async (req, res) => {
  try {
    const vendasHora = await carregarModeloVendasHora(pool, req.eventoId);
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ vendasHora, sumarioArrecadacao: painel.sumarioArrecadacao, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/vendas-hora/carregar-modelo', err);
    res.status(500).json({ error: 'Falha ao carregar modelo de vendas na hora' });
  }
});

app.get('/api/financeiro/bebidas', requireEvento, async (req, res) => {
  try {
    const bebidas = await listBebidas(pool, req.eventoId);
    res.json({ bebidas });
  } catch (err) {
    console.error('GET /api/financeiro/bebidas', err);
    res.status(500).json({ error: 'Falha ao carregar arrecadação de bebidas' });
  }
});

app.patch('/api/financeiro/bebidas/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await patchBebida(pool, id, req.eventoId, req.body);
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    const bebidas = await listBebidas(pool, req.eventoId);
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ item, bebidas, sumarioArrecadacao: painel.sumarioArrecadacao, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/bebidas/:id', err);
    res.status(500).json({ error: 'Falha ao salvar item de bebida' });
  }
});

app.post('/api/financeiro/bebidas/carregar-modelo', requireEvento, async (req, res) => {
  try {
    const bebidas = await carregarModeloBebidas(pool, req.eventoId);
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ bebidas, sumarioArrecadacao: painel.sumarioArrecadacao, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/bebidas/carregar-modelo', err);
    res.status(500).json({ error: 'Falha ao carregar modelo de bebidas' });
  }
});

app.patch('/api/financeiro/resultado-final/faturamento-praca', requireEvento, async (req, res) => {
  try {
    const { previsto, realizado } = req.body ?? {};
    const result = await patchFaturamentoPracaAlimentacao(pool, req.eventoId, { previsto, realizado });
    const painel = await buildFinanceiroPainel(pool, req.eventoId);
    res.json({ ...result, resultadoFinal: painel.resultadoFinal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/financeiro/resultado-final/faturamento-praca', err);
    res.status(500).json({ error: 'Falha ao salvar faturamento da praça de alimentação' });
  }
});

app.get('/api/financeiro/resultado', requireEvento, async (req, res) => {
  try {
    const linhas = await listFinanceiroResultado(pool, req.eventoId);
    res.json({ linhas });
  } catch (err) {
    console.error('GET /api/financeiro/resultado', err);
    res.status(500).json({ error: 'Falha ao carregar resultado financeiro' });
  }
});

app.post('/api/financeiro/resultado/carregar-modelo', requireEvento, async (req, res) => {
  try {
    const substituir = req.body?.substituir === true;
    const linhas = await carregarModeloFinanceiroResultado(pool, req.eventoId, { substituir });
    res.json({ linhas });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/resultado/carregar-modelo', err);
    res.status(500).json({ error: 'Falha ao carregar modelo' });
  }
});

app.post('/api/financeiro/resultado/linhas', requireEvento, async (req, res) => {
  try {
    const linha = await createFinanceiroLinha(pool, req.eventoId, req.body);
    res.status(201).json({ linha });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/financeiro/resultado/linhas', err);
    res.status(500).json({ error: 'Falha ao criar linha' });
  }
});

app.put('/api/financeiro/resultado/linhas/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const linha = await updateFinanceiroLinha(pool, id, req.eventoId, req.body);
    if (!linha) return res.status(404).json({ error: 'Linha não encontrada' });
    res.json({ linha });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/financeiro/resultado/linhas/:id', err);
    res.status(500).json({ error: 'Falha ao atualizar linha' });
  }
});

app.post('/api/financeiro/resultado/limpar', requireEvento, async (req, res) => {
  try {
    const removidas = await clearFinanceiroResultado(pool, req.eventoId);
    res.json({ ok: true, removidas });
  } catch (err) {
    console.error('POST /api/financeiro/resultado/limpar', err);
    res.status(500).json({ error: 'Falha ao limpar custos do evento' });
  }
});

app.delete('/api/financeiro/resultado/linhas/:id', requireEvento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteFinanceiroLinha(pool, id, req.eventoId);
    if (!ok) return res.status(404).json({ error: 'Linha não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/financeiro/resultado/linhas/:id', err);
    res.status(500).json({ error: 'Falha ao excluir linha' });
  }
});

app.get('/api/permission-groups/catalog', async (_req, res) => {
  res.json({ catalog: PERMISSION_CATALOG });
});

app.get('/api/permission-groups', async (_req, res) => {
  try {
    const groups = await listPermissionGroups(pool);
    res.json({ groups });
  } catch (err) {
    console.error('GET /api/permission-groups', err);
    res.status(500).json({ error: 'Falha ao carregar grupos de permissão' });
  }
});

app.post('/api/permission-groups', async (req, res) => {
  try {
    const group = await createPermissionGroup(pool, req.body);
    res.status(201).json({ group });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Já existe um grupo com este nome' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/permission-groups', err);
    res.status(500).json({ error: err.sqlMessage || 'Falha ao criar grupo' });
  }
});

app.put('/api/permission-groups/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const group = await updatePermissionGroup(pool, id, req.body);
    if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json({ group });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Já existe um grupo com este nome' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/permission-groups/:id', err);
    res.status(500).json({ error: err.sqlMessage || 'Falha ao atualizar grupo' });
  }
});

app.delete('/api/permission-groups/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deletePermissionGroup(pool, id);
    if (!ok) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/permission-groups/:id', err);
    res.status(500).json({ error: 'Falha ao excluir grupo' });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    const users = await listUsers(pool);
    res.json({ users });
  } catch (err) {
    console.error('GET /api/users', err);
    res.status(500).json({ error: 'Falha ao carregar usuários' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const input = normalizeUserInput(req.body, { requirePassword: true });
    const passwordHash = await hashPassword(input.password);
    let permissionGroupId = input.permissionGroupId;
    if (!permissionGroupId) {
      permissionGroupId = await getDefaultPermissionGroupId(pool);
    }
    const user = await createUser(pool, { ...input, passwordHash, permissionGroupId });
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

app.put('/api/users/:id', async (req, res) => {
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

    const user = await updateUser(pool, id, { ...input, passwordHash, permissionGroupId: input.permissionGroupId });
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

app.delete('/api/users/:id', async (req, res) => {
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

app.post('/api/grupos/:slug/espacos/mover-grupo', requireEvento, async (req, res) => {
  try {
    const movimentos = req.body?.movimentos;
    if (!Array.isArray(movimentos) || movimentos.length === 0) {
      return res.status(400).json({ error: 'Campo movimentos é obrigatório' });
    }

    await moveEspacosReservas(pool, req.params.slug, req.body, req.eventoId);
    await ensureTiposComercio(pool, [req.body?.tipo]);
    const result = await fetchSpacesByGrupo(pool, req.params.slug, req.eventoId);
    const tipos = await fetchTiposComercio(pool);
    const participantes = attachAvatarUrlsToParticipantes(
      await listParticipantes(pool),
      req.eventoId,
    );
    res.json({ ...result, tipos, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/grupos/:slug/espacos/mover-grupo', err);
    res.status(500).json({ error: 'Falha ao mover reservas de espaço' });
  }
});

app.post('/api/grupos/:slug/espacos/:numero/mover', requireEvento, async (req, res) => {
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
    const participantes = attachAvatarUrlsToParticipantes(
      await listParticipantes(pool),
      req.eventoId,
    );
    res.json({ ...result, tipos, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/grupos/:slug/espacos/:numero/mover', err);
    res.status(500).json({ error: 'Falha ao mover reserva de espaço' });
  }
});

app.put('/api/grupos/:slug/espacos', requireEvento, async (req, res) => {
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
    const participantes = attachAvatarUrlsToParticipantes(
      await listParticipantes(pool),
      req.eventoId,
    );
    res.json({ ...result, tipos, participantes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('PUT /api/grupos/:slug/espacos', err);
    res.status(500).json({ error: 'Falha ao salvar espaços' });
  }
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Arquivo muito grande. O limite é 16 MB.' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Corpo da requisição inválido' });
  }
  next(err);
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
  await migrateProducaoCronologia(pool);
  await migrateProducaoPremiacoes(pool);
  await migrateFinanceiroResultado(pool);
  await migrateFinanceiroContasPagar(pool);
  await migrateWhatsapp(pool);
  await migrateSeguidoresHistorico(pool);
  await migrateTiposComercio(pool);
  await migrateUsers(pool);
  await migrateAuthOtp(pool);
  await migratePermissions(pool);

  const server = http.createServer(app);
  attachWhatsappWebSocket(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\nPorta ${PORT} já está em uso. Rode "npm run dev" (libera as portas automaticamente) ou:\n` +
          `  lsof -i :${PORT} -t | xargs kill -9\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Opalapa Gestão rodando na porta ${PORT}`);
    startWhatsappMediaWorker(pool);
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
  const hint = formatDatabaseStartupError(err, DATABASE_URL);
  if (hint) {
    console.error(hint);
  } else {
    console.error('Falha ao iniciar servidor:', err);
  }
  process.exit(1);
});
