import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from './db.js';
import { migrateEspacos, fetchSpacesByGrupo, upsertSpaces } from './espacos.js';
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
  createPatrocinio,
  updateArrecadacao,
  deleteArrecadacao,
  summarizeArrecadacao,
} from './arrecadacao.js';
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

app.get('/api/grupos', requireAuth, async (_req, res) => {
  try {
    const grupos = await fetchGrupos(pool);
    res.json({ grupos });
  } catch (err) {
    console.error('GET /api/grupos', err);
    res.status(500).json({ error: 'Falha ao carregar agrupamentos' });
  }
});

app.get('/api/grupos/:slug/espacos', requireAuth, async (req, res) => {
  try {
    const result = await fetchSpacesByGrupo(pool, req.params.slug);
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

app.delete('/api/participantes/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const refs = await countReferenciasParticipante(pool, id);
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

app.get('/api/arrecadacao', requireAuth, async (_req, res) => {
  try {
    const items = await listArrecadacao(pool);
    const participantes = await listParticipantes(pool);
    res.json({ items, resumo: summarizeArrecadacao(items), participantes });
  } catch (err) {
    console.error('GET /api/arrecadacao', err);
    res.status(500).json({ error: 'Falha ao carregar arrecadação' });
  }
});

app.post('/api/arrecadacao', requireAuth, async (req, res) => {
  try {
    const item = await createPatrocinio(pool, req.body);
    res.status(201).json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/arrecadacao', err);
    res.status(500).json({ error: 'Falha ao cadastrar patrocínio' });
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

app.put('/api/grupos/:slug/espacos', requireAuth, async (req, res) => {
  try {
    const updates = req.body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Campo updates é obrigatório' });
    }

    await upsertSpaces(pool, req.params.slug, updates);
    await ensureTiposComercio(
      pool,
      updates.map((u) => u.tipo),
    );
    const result = await fetchSpacesByGrupo(pool, req.params.slug);
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
  await migrateEspacos(pool);
  await migrateArrecadacao(pool);
  await migrateTiposComercio(pool);
  await migrateUsers(pool);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Opalapa Gestão rodando na porta ${PORT}`);
  });

  syncAllArrecadacaoFromEspacos(pool).catch((err) => {
    console.error('Falha ao sincronizar arrecadação dos espaços:', err);
  });
}

start().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});
