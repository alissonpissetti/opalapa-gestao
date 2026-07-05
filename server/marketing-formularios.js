import fs from 'fs/promises';
import path from 'path';
import { createPatrocinio, findArrecadacaoById, updateArrecadacao } from './arrecadacao.js';
import { createInteracao } from './interacoes.js';
import { findParticipanteByContato } from './participantes.js';

const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'money', 'email', 'phone', 'select', 'checkbox']);
const SELECT_OTHER_VALUE = '__outro__';
const LOGO_ROOT = process.env.FORMULARIOS_LOGO_DIR || path.join(process.cwd(), 'data', 'formularios-logos');
const LOGO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CLASSIFICACOES = new Set(['pendente', 'em_analise', 'aprovado', 'reprovado']);
const LEAD_TIPOS_FORM = ['patrocinio', 'artistico', 'alimentacao'];

function normalizeTipoLead(raw) {
  const tipo = String(raw || 'patrocinio');
  if (tipo === 'artistico' || tipo === 'alimentacao') return tipo;
  return 'patrocinio';
}

async function findExistingLeadForParticipante(pool, eventoId, participanteId, tipoPreferido) {
  const tiposBusca = [tipoPreferido, ...LEAD_TIPOS_FORM.filter((t) => t !== tipoPreferido)];

  for (const tipo of tiposBusca) {
    const [rows] = await pool.query(
      `SELECT id, obs FROM arrecadacao
       WHERE evento_id = ? AND participante_id = ? AND tipo = ?
       ORDER BY updated_at DESC LIMIT 1`,
      [eventoId, participanteId, tipo],
    );
    if (rows[0]) {
      return { id: Number(rows[0].id), obs: rows[0].obs || '' };
    }
  }
  return null;
}

async function vincularRespostaAoLead(pool, form, leadId, participante, existingObs = '') {
  const note = `Candidatura via formulário "${form.nome}"`;
  const obsBase = existingObs || '';
  const obs =
    obsBase && !obsBase.includes(note) ? `${obsBase}\n\n${note}` : obsBase || note;

  await updateArrecadacao(pool, leadId, {
    marketingCanalId: form.marketingCanalId,
    marketingCampanhaId: form.marketingCampanhaId,
    marketingCriativoId: form.marketingCriativoId,
    obs,
  });

  const resumo = formatRespostasTexto(form.campos, participante.respostas);
  if (resumo) {
    await createInteracao(pool, leadId, {
      tipo: 'nota',
      texto: `Respostas do formulário "${form.nome}":\n${resumo}`,
    });
  }
}

function slugify(value) {
  return (
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'formulario'
  );
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToFormulario(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    nome: row.nome,
    slug: row.slug,
    ativo: Boolean(row.ativo),
    introducao: row.introducao || '',
    secoes: parseJson(row.secoes, []),
    tipoLead: row.tipo_lead || 'patrocinio',
    descricaoLead: row.descricao_lead || '',
    statusInicial: row.status_inicial || 'lead',
    marketingCanalId: row.marketing_canal_id ? Number(row.marketing_canal_id) : null,
    marketingCampanhaId: row.marketing_campanha_id ? Number(row.marketing_campanha_id) : null,
    marketingCriativoId: row.marketing_criativo_id ? Number(row.marketing_criativo_id) : null,
    campos: parseJson(row.campos, []),
    logoPath: row.logo_path || null,
    hasLogo: Boolean(row.logo_path),
    corFundo: row.cor_fundo || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function rowToResposta(row) {
  return {
    id: row.id,
    formularioId: Number(row.formulario_id),
    arrecadacaoId: row.arrecadacao_id ? Number(row.arrecadacao_id) : null,
    participanteNome: row.participante_nome || '',
    participanteTelefone: row.participante_telefone || '',
    participanteInstagram: row.participante_instagram || '',
    respostas: parseJson(row.respostas, {}),
    classificacao: row.classificacao || 'pendente',
    notaInterna: row.nota_interna || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function sortOptionsAlphabetically(options) {
  return [...options].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

function parseMoneyValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  return parseInt(digits, 10) / 100;
}

function formatMoneyBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function extForMimetype(mimetype) {
  const ct = String(mimetype || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}

function mimetypeForLogoPath(logoPath) {
  const ext = path.extname(String(logoPath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function resolveLogoFilePath(formularioId) {
  const full = path.join(LOGO_ROOT, String(formularioId));
  if (!full.startsWith(LOGO_ROOT)) {
    throw Object.assign(new Error('Caminho de logomarca inválido'), { status: 400 });
  }
  return full;
}

async function findLogoFile(formularioId, logoPath) {
  if (!logoPath) return null;
  const rel = String(logoPath).replace(/^file:/, '');
  const full = path.join(LOGO_ROOT, rel);
  if (!full.startsWith(LOGO_ROOT)) return null;
  try {
    return await fs.readFile(full);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function parseLogoPayload(raw) {
  if (raw.removeLogo === true || raw.removerLogo === true) return { remove: true };
  const dataUrl = raw.logoData ?? raw.logo_data;
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw Object.assign(new Error('Logomarca inválida'), { status: 400 });
  }
  const mimetype = match[1].toLowerCase();
  if (!LOGO_MIMES.has(mimetype)) {
    throw Object.assign(new Error('Use PNG, JPG, WEBP ou GIF na logomarca'), { status: 400 });
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    throw Object.assign(new Error('Logomarca muito grande (máx. 2 MB)'), { status: 400 });
  }
  return { buffer, mimetype };
}

async function deleteLogoFile(logoPath) {
  if (!logoPath) return;
  const rel = String(logoPath).replace(/^file:/, '');
  const full = path.join(LOGO_ROOT, rel);
  try {
    await fs.unlink(full);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function saveLogoFile(formularioId, buffer, mimetype) {
  const ext = extForMimetype(mimetype);
  const rel = `${formularioId}${ext}`;
  const full = resolveLogoFilePath(formularioId) + ext;
  await fs.mkdir(LOGO_ROOT, { recursive: true });
  await fs.writeFile(full, buffer);
  return `file:${rel}`;
}

async function applyLogoUpdate(pool, formularioId, raw) {
  const parsed = parseLogoPayload(raw);
  if (!parsed) return;

  const [rows] = await pool.query(
    'SELECT logo_path FROM marketing_formularios WHERE id = ? LIMIT 1',
    [formularioId],
  );
  const currentPath = rows[0]?.logo_path || null;

  if (parsed.remove) {
    await deleteLogoFile(currentPath);
    await pool.query(
      'UPDATE marketing_formularios SET logo_path = NULL, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [formularioId],
    );
    return;
  }

  await deleteLogoFile(currentPath);
  const logoPath = await saveLogoFile(formularioId, parsed.buffer, parsed.mimetype);
  await pool.query(
    'UPDATE marketing_formularios SET logo_path = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [logoPath, formularioId],
  );
}

function normalizeCampo(raw, index) {
  const id = String(raw.id || raw.key || `campo_${index + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 48);
  const label = String(raw.label || raw.titulo || `Campo ${index + 1}`).trim();
  const type = FIELD_TYPES.has(raw.type) ? raw.type : 'text';
  const required = Boolean(raw.required ?? raw.obrigatorio);
  const options = sortOptionsAlphabetically(
    Array.isArray(raw.options)
      ? raw.options.map((o) => String(o).trim()).filter(Boolean)
      : String(raw.options || '')
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
  );

  if (!label) {
    throw Object.assign(new Error(`Informe o rótulo do campo ${index + 1}`), { status: 400 });
  }
  if (type === 'select' && !options.length) {
    throw Object.assign(new Error(`Campo "${label}" precisa de opções`), { status: 400 });
  }

  const allowOther = type === 'select' ? Boolean(raw.allowOther ?? raw.permitir_outro) : false;
  const selectOptions =
    type === 'select'
      ? options.filter((o) => String(o).trim().toLowerCase() !== 'outro')
      : [];

  return {
    id,
    label,
    type,
    required,
    allowOther,
    options: type === 'select' ? selectOptions : [],
  };
}

function normalizeSecao(raw, index) {
  const id = String(raw?.id || `secao_${index + 1}`).trim() || `secao_${index + 1}`;
  return {
    id,
    titulo: String(raw?.titulo || '').trim(),
    texto: String(raw?.texto || '').trim(),
  };
}

function normalizeSecoes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((secao, index) => normalizeSecao(secao, index)).filter((s) => s.titulo || s.texto);
}

function normalizeCampos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((campo, index) => normalizeCampo(campo, index));
}

async function ensureUniqueSlug(pool, eventoId, baseSlug, ignoreId = null) {
  let slug = slugify(baseSlug);
  let suffix = 1;
  for (;;) {
    const params = [eventoId, slug];
    let sql = 'SELECT id FROM marketing_formularios WHERE evento_id = ? AND slug = ?';
    if (ignoreId) {
      sql += ' AND id <> ?';
      params.push(ignoreId);
    }
    sql += ' LIMIT 1';
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return slug;
    suffix += 1;
    slug = `${slugify(baseSlug).slice(0, 58)}-${suffix}`;
  }
}

function formatRespostasTexto(campos, respostas) {
  const lines = [];
  for (const campo of campos) {
    const value = respostas[campo.id];
    if (value == null || value === '') continue;
    let rendered;
    if (campo.type === 'checkbox') rendered = value ? 'Sim' : 'Não';
    else if (campo.type === 'money') rendered = formatMoneyBRL(value);
    else rendered = String(value).trim();
    lines.push(`${campo.label}: ${rendered}`);
  }
  return lines.join('\n');
}

function validateRespostas(campos, respostas, participante) {
  const nome = String(participante.nome || '').trim();
  const telefone = String(participante.telefone || '').trim();
  if (!nome) {
    throw Object.assign(new Error('Informe seu nome'), { status: 400 });
  }
  if (!telefone) {
    throw Object.assign(new Error('Informe seu telefone ou WhatsApp'), { status: 400 });
  }

  const normalized = { ...(respostas || {}) };
  for (const campo of campos) {
    const raw = normalized[campo.id];
    const empty =
      raw == null ||
      raw === '' ||
      (campo.type === 'checkbox' && raw !== true && raw !== false && raw !== 'true' && raw !== 'false');

    if (campo.required && empty) {
      throw Object.assign(new Error(`Preencha o campo "${campo.label}"`), { status: 400 });
    }

    if (campo.type === 'checkbox') {
      normalized[campo.id] = raw === true || raw === 'true' || raw === 1 || raw === '1';
    } else if (campo.type === 'money') {
      if (empty) continue;
      const parsed = parseMoneyValue(raw);
      if (parsed == null) {
        throw Object.assign(new Error(`Valor inválido em "${campo.label}"`), { status: 400 });
      }
      normalized[campo.id] = parsed;
    } else if (campo.type === 'select') {
      if (empty) continue;
      const value = String(raw).trim();
      if (value === SELECT_OTHER_VALUE) {
        throw Object.assign(new Error(`Informe o valor em "${campo.label}"`), { status: 400 });
      }
      const options = (campo.options || []).map((o) => String(o).trim());
      const inOptions = options.includes(value);
      if (!inOptions && !campo.allowOther) {
        throw Object.assign(new Error(`Opção inválida em "${campo.label}"`), { status: 400 });
      }
      if (!inOptions && campo.allowOther && !value) {
        throw Object.assign(new Error(`Informe o valor em "${campo.label}"`), { status: 400 });
      }
      normalized[campo.id] = value;
    } else if (!empty) {
      normalized[campo.id] = String(raw).trim();
    }
  }

  return { nome, telefone, instagram: String(participante.instagram || '').trim(), respostas: normalized };
}

export async function migrateMarketingFormularios(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_formularios (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(160) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      introducao TEXT NULL,
      tipo_lead VARCHAR(24) NOT NULL DEFAULT 'patrocinio',
      descricao_lead VARCHAR(160) NOT NULL DEFAULT '',
      status_inicial VARCHAR(32) NOT NULL DEFAULT 'lead',
      marketing_canal_id INT UNSIGNED NULL,
      marketing_campanha_id INT UNSIGNED NULL,
      marketing_criativo_id INT UNSIGNED NULL,
      campos JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_marketing_form_evento_slug (evento_id, slug),
      INDEX idx_marketing_form_evento (evento_id),
      INDEX idx_marketing_form_slug (slug),
      CONSTRAINT fk_marketing_form_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_formulario_respostas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      formulario_id INT UNSIGNED NOT NULL,
      arrecadacao_id INT UNSIGNED NULL,
      participante_nome VARCHAR(160) NOT NULL,
      participante_telefone VARCHAR(40) NOT NULL,
      participante_instagram VARCHAR(80) NULL,
      respostas JSON NOT NULL,
      classificacao VARCHAR(24) NOT NULL DEFAULT 'pendente',
      nota_interna TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_mfr_formulario (formulario_id),
      INDEX idx_mfr_arrecadacao (arrecadacao_id),
      INDEX idx_mfr_classificacao (classificacao),
      CONSTRAINT fk_mfr_formulario FOREIGN KEY (formulario_id) REFERENCES marketing_formularios(id) ON DELETE CASCADE,
      CONSTRAINT fk_mfr_arrecadacao FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketing_formularios'`,
  );
  const colSet = new Set(cols.map((c) => c.name));
  if (!colSet.has('logo_path')) {
    await pool.query('ALTER TABLE marketing_formularios ADD COLUMN logo_path VARCHAR(255) NULL AFTER campos');
  }
  if (!colSet.has('cor_fundo')) {
    await pool.query('ALTER TABLE marketing_formularios ADD COLUMN cor_fundo VARCHAR(16) NULL AFTER logo_path');
  }
  if (!colSet.has('secoes')) {
    await pool.query('ALTER TABLE marketing_formularios ADD COLUMN secoes JSON NULL AFTER introducao');
  }
}

function normalizeCorFundo(raw) {
  if (raw === undefined) return undefined;
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw Object.assign(new Error('Cor de fundo inválida. Use o formato #RRGGBB.'), { status: 400 });
  }
  return value.toLowerCase();
}

export async function listMarketingFormularios(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT f.*,
            (SELECT COUNT(*) FROM marketing_formulario_respostas r WHERE r.formulario_id = f.id) AS total_respostas,
            (SELECT COUNT(*) FROM marketing_formulario_respostas r WHERE r.formulario_id = f.id AND r.classificacao = 'pendente') AS pendentes
     FROM marketing_formularios f
     WHERE f.evento_id = ?
     ORDER BY f.nome ASC, f.id ASC`,
    [eventoId],
  );
  return rows.map((row) => ({
    ...rowToFormulario(row),
    totalRespostas: Number(row.total_respostas || 0),
    pendentes: Number(row.pendentes || 0),
  }));
}

export async function findMarketingFormularioById(pool, id, eventoId) {
  const [rows] = await pool.query(
    'SELECT * FROM marketing_formularios WHERE id = ? AND evento_id = ? LIMIT 1',
    [id, eventoId],
  );
  return rows[0] ? rowToFormulario(rows[0]) : null;
}

export async function findMarketingFormularioBySlug(pool, slug) {
  const [rows] = await pool.query(
    'SELECT * FROM marketing_formularios WHERE slug = ? AND ativo = 1 LIMIT 1',
    [slug],
  );
  return rows[0] ? rowToFormulario(rows[0]) : null;
}

export async function createMarketingFormulario(pool, eventoId, raw) {
  const nome = String(raw.nome || '').trim();
  if (!nome) {
    throw Object.assign(new Error('Informe o nome do formulário'), { status: 400 });
  }

  const campos = normalizeCampos(raw.campos);
  const secoes = normalizeSecoes(raw.secoes);
  const slug = await ensureUniqueSlug(pool, eventoId, raw.slug || nome);
  const tipoLead = normalizeTipoLead(raw.tipoLead);

  const corFundo = normalizeCorFundo(raw.corFundo ?? raw.cor_fundo) ?? null;

  const [result] = await pool.query(
    `INSERT INTO marketing_formularios
       (evento_id, nome, slug, ativo, introducao, secoes, tipo_lead, descricao_lead, status_inicial,
        marketing_canal_id, marketing_campanha_id, marketing_criativo_id, campos, cor_fundo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      nome,
      slug,
      raw.ativo === false ? 0 : 1,
      String(raw.introducao || '').trim() || null,
      JSON.stringify(secoes),
      tipoLead,
      String(raw.descricaoLead || raw.descricao_lead || nome).trim() || nome,
      String(raw.statusInicial || raw.status_inicial || 'lead').trim() || 'lead',
      raw.marketingCanalId ?? raw.marketing_canal_id ?? null,
      raw.marketingCampanhaId ?? raw.marketing_campanha_id ?? null,
      raw.marketingCriativoId ?? raw.marketing_criativo_id ?? null,
      JSON.stringify(campos),
      corFundo,
    ],
  );

  const form = await findMarketingFormularioById(pool, result.insertId, eventoId);
  await applyLogoUpdate(pool, form.id, raw);
  return findMarketingFormularioById(pool, form.id, eventoId);
}

export async function updateMarketingFormulario(pool, id, eventoId, raw) {
  const existing = await findMarketingFormularioById(pool, id, eventoId);
  if (!existing) return null;

  const nome = raw.nome !== undefined ? String(raw.nome).trim() : existing.nome;
  if (!nome) {
    throw Object.assign(new Error('Informe o nome do formulário'), { status: 400 });
  }

  const campos = raw.campos !== undefined ? normalizeCampos(raw.campos) : existing.campos;
  const secoes = raw.secoes !== undefined ? normalizeSecoes(raw.secoes) : existing.secoes;
  const slug =
    raw.slug !== undefined || raw.nome !== undefined
      ? await ensureUniqueSlug(pool, eventoId, raw.slug || nome, id)
      : existing.slug;
  const tipoLead =
    raw.tipoLead !== undefined ? normalizeTipoLead(raw.tipoLead) : existing.tipoLead;

  const corFundo =
    raw.corFundo !== undefined || raw.cor_fundo !== undefined
      ? normalizeCorFundo(raw.corFundo ?? raw.cor_fundo)
      : existing.corFundo || null;

  await pool.query(
    `UPDATE marketing_formularios SET
       nome = ?, slug = ?, ativo = ?, introducao = ?, secoes = ?, tipo_lead = ?, descricao_lead = ?,
       status_inicial = ?, marketing_canal_id = ?, marketing_campanha_id = ?, marketing_criativo_id = ?,
       campos = ?, cor_fundo = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [
      nome,
      slug,
      raw.ativo === undefined ? (existing.ativo ? 1 : 0) : raw.ativo ? 1 : 0,
      raw.introducao !== undefined ? String(raw.introducao).trim() || null : existing.introducao || null,
      JSON.stringify(secoes),
      tipoLead,
      raw.descricaoLead !== undefined
        ? String(raw.descricaoLead).trim() || nome
        : existing.descricaoLead,
      raw.statusInicial !== undefined
        ? String(raw.statusInicial).trim() || 'lead'
        : existing.statusInicial,
      raw.marketingCanalId !== undefined
        ? raw.marketingCanalId
        : raw.marketing_canal_id !== undefined
          ? raw.marketing_canal_id
          : existing.marketingCanalId,
      raw.marketingCampanhaId !== undefined
        ? raw.marketingCampanhaId
        : raw.marketing_campanha_id !== undefined
          ? raw.marketing_campanha_id
          : existing.marketingCampanhaId,
      raw.marketingCriativoId !== undefined
        ? raw.marketingCriativoId
        : raw.marketing_criativo_id !== undefined
          ? raw.marketing_criativo_id
          : existing.marketingCriativoId,
      JSON.stringify(campos),
      corFundo,
      id,
      eventoId,
    ],
  );

  await applyLogoUpdate(pool, id, raw);
  return findMarketingFormularioById(pool, id, eventoId);
}

export async function deleteMarketingFormulario(pool, id, eventoId) {
  const existing = await findMarketingFormularioById(pool, id, eventoId);
  if (!existing) return false;
  await deleteLogoFile(existing.logoPath);
  const [result] = await pool.query(
    'DELETE FROM marketing_formularios WHERE id = ? AND evento_id = ?',
    [id, eventoId],
  );
  return result.affectedRows > 0;
}

export async function readMarketingFormularioLogo(pool, { id, slug, eventoId } = {}) {
  let form = null;
  if (id) {
    const [rows] = await pool.query(
      'SELECT id, slug, logo_path, evento_id FROM marketing_formularios WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows[0] || (eventoId && Number(rows[0].evento_id) !== Number(eventoId))) return null;
    form = rows[0];
  } else if (slug) {
    const [rows] = await pool.query(
      'SELECT id, slug, logo_path FROM marketing_formularios WHERE slug = ? AND ativo = 1 LIMIT 1',
      [slug],
    );
    form = rows[0] || null;
  }
  if (!form?.logo_path) return null;
  const buffer = await findLogoFile(form.id, form.logo_path);
  if (!buffer) return null;
  return { buffer, mimetype: mimetypeForLogoPath(form.logo_path) };
}

export async function listFormularioRespostas(pool, formularioId, eventoId) {
  const form = await findMarketingFormularioById(pool, formularioId, eventoId);
  if (!form) return null;

  const [rows] = await pool.query(
    `SELECT r.*
     FROM marketing_formulario_respostas r
     JOIN marketing_formularios f ON f.id = r.formulario_id
     WHERE r.formulario_id = ? AND f.evento_id = ?
     ORDER BY r.created_at DESC, r.id DESC`,
    [formularioId, eventoId],
  );

  return {
    formulario: form,
    respostas: rows.map(rowToResposta),
  };
}

export async function updateFormularioResposta(pool, id, eventoId, raw) {
  const [rows] = await pool.query(
    `SELECT r.*, f.evento_id
     FROM marketing_formulario_respostas r
     JOIN marketing_formularios f ON f.id = r.formulario_id
     WHERE r.id = ? AND f.evento_id = ?
     LIMIT 1`,
    [id, eventoId],
  );
  const row = rows[0];
  if (!row) return null;

  const classificacao = raw.classificacao !== undefined ? String(raw.classificacao) : row.classificacao;
  if (!CLASSIFICACOES.has(classificacao)) {
    throw Object.assign(new Error('Classificação inválida'), { status: 400 });
  }

  const notaInterna =
    raw.notaInterna !== undefined ? String(raw.notaInterna).trim() : row.nota_interna || '';

  await pool.query(
    `UPDATE marketing_formulario_respostas
     SET classificacao = ?, nota_interna = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [classificacao, notaInterna || null, id],
  );

  if (row.arrecadacao_id && raw.atualizarLead !== false) {
    const leadPatch = {};
    if (classificacao === 'aprovado' && raw.statusLead) {
      leadPatch.status = raw.statusLead;
    } else if (classificacao === 'reprovado') {
      leadPatch.status = raw.statusLead || 'perda';
      if (raw.motivoPerda) leadPatch.motivoPerda = raw.motivoPerda;
    }
    if (Object.keys(leadPatch).length) {
      await updateArrecadacao(pool, row.arrecadacao_id, leadPatch);
    }
  }

  const [updated] = await pool.query(
    'SELECT * FROM marketing_formulario_respostas WHERE id = ? LIMIT 1',
    [id],
  );
  return updated[0] ? rowToResposta(updated[0]) : null;
}

export async function getPublicFormulario(pool, slug) {
  const form = await findMarketingFormularioBySlug(pool, slug);
  if (!form) return null;

  const [eventoRows] = await pool.query('SELECT id, nome FROM eventos WHERE id = ? LIMIT 1', [
    form.eventoId,
  ]);
  const evento = eventoRows[0];

  return {
    slug: form.slug,
    nome: form.nome,
    introducao: form.introducao,
    secoes: form.secoes,
    campos: form.campos,
    eventoNome: evento?.nome || '',
    logoUrl: form.hasLogo ? `/api/public/formularios/${encodeURIComponent(form.slug)}/logo` : null,
    corFundo: form.corFundo || null,
  };
}

export async function submitPublicFormulario(pool, slug, raw) {
  const form = await findMarketingFormularioBySlug(pool, slug);
  if (!form) {
    throw Object.assign(new Error('Formulário não encontrado'), { status: 404 });
  }

  const participante = validateRespostas(form.campos, raw.respostas, {
    nome: raw.nome ?? raw.participanteNome ?? raw.participante_nome,
    telefone: raw.telefone ?? raw.participanteTelefone ?? raw.participante_whatsapp,
    instagram: raw.instagram ?? raw.participanteInstagram ?? raw.participante_instagram,
  });

  const tipoLead = normalizeTipoLead(form.tipoLead);

  const conn = await pool.getConnection();
  let participanteIdExistente = null;
  try {
    participanteIdExistente = await findParticipanteByContato(conn, {
      telefone: participante.telefone,
      instagram: participante.instagram,
    });
  } finally {
    conn.release();
  }

  let lead = null;
  let existingObs = '';

  if (participanteIdExistente) {
    const existingLead = await findExistingLeadForParticipante(
      pool,
      form.eventoId,
      participanteIdExistente,
      tipoLead,
    );
    if (existingLead) {
      lead = await findArrecadacaoById(pool, existingLead.id);
      existingObs = existingLead.obs || lead?.obs || '';
    }
  }

  if (!lead) {
    lead = await createPatrocinio(pool, form.eventoId, {
      novoParticipante: !participanteIdExistente,
      participanteId: participanteIdExistente || undefined,
      participanteNome: participante.nome,
      participanteWhatsapp: participante.telefone,
      participanteInstagram: participante.instagram || undefined,
      tipo: tipoLead,
      descricao: form.descricaoLead,
      status: form.statusInicial,
      valorTotal: 0,
      valorPago: 0,
      obs: `Candidatura via formulário "${form.nome}"`,
    });
    await vincularRespostaAoLead(pool, form, lead.id, participante);
  } else {
    await vincularRespostaAoLead(pool, form, lead.id, participante, existingObs);
  }

  const [result] = await pool.query(
    `INSERT INTO marketing_formulario_respostas
       (formulario_id, arrecadacao_id, participante_nome, participante_telefone, participante_instagram,
        respostas, classificacao, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', CURRENT_TIMESTAMP(3))`,
    [
      form.id,
      lead.id,
      participante.nome,
      participante.telefone,
      participante.instagram || null,
      JSON.stringify(participante.respostas),
    ],
  );

  return {
    ok: true,
    respostaId: result.insertId,
    mensagem: 'Respostas enviadas com sucesso. Em breve entraremos em contato.',
  };
}
