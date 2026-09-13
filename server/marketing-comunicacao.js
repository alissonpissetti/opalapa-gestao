import { toWhatsAppNumber } from './whatsapp-phone.js';
import { sendWhatsappToLead, getWhatsappStatusQuick } from './whatsapp.js';

const TIPO_LABELS = {
  espaco: 'Espaço',
  patrocinio: 'Patrocínio',
  artistico: 'Artístico',
  contato: 'Contato',
};

const TIPO_PRIORITY = { espaco: 0, patrocinio: 1, artistico: 2, contato: 3 };

const COMUNICACAO_STATUS = new Set(['rascunho', 'preview', 'enviando', 'pausado', 'concluido']);
const ITEM_STATUS = new Set(['pendente', 'enviado', 'reenvio_pendente', 'erro', 'ignorado']);

export const COMUNICACAO_TEMPLATE_VARS = [
  { key: 'nome', label: 'Nome do contato (pessoa)' },
  { key: 'empresa', label: 'Nome da empresa / patrocinador' },
  { key: 'tipo', label: 'Tipo do lead (Espaço, Patrocínio…)' },
  { key: 'espaco', label: 'Espaço vinculado (rótulo ou número)' },
  { key: 'grupo', label: 'Grupo do espaço' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'telefone', label: 'Telefone / WhatsApp' },
  { key: 'contato', label: 'Nome do contato (igual a {{nome}})' },
  { key: 'descricao', label: 'Descrição do lead' },
  { key: 'cota', label: 'Cota / descrição do patrocínio' },
  { key: 'produto', label: 'Nome do plano/produto' },
  { key: 'status', label: 'Etapa do funil (status)' },
  { key: 'valor_total', label: 'Valor total (R$)' },
  { key: 'valor_pago', label: 'Valor já pago (R$)' },
  { key: 'valor_em_aberto', label: 'Valor em aberto (R$)' },
  { key: 'evento', label: 'Nome do evento' },
];

const VALID_TIPOS = new Set(Object.keys(TIPO_LABELS));

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function tipoLabel(tipo) {
  return TIPO_LABELS[tipo] || tipo || '';
}

function espacoLabel(row) {
  if (row.espaco_label) return String(row.espaco_label);
  if (row.espaco_numero != null) return `Espaço ${row.espaco_numero}`;
  return '';
}

function valorEmAberto(row) {
  const total = Number(row.valor_total || 0);
  const pago = Number(row.valor_pago || 0);
  return Math.max(0, total - pago);
}

function hasValidPhone(phone) {
  return Boolean(toWhatsAppNumber(phone));
}

export function renderComunicacaoTemplate(template, ctx) {
  return String(template || '').replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => {
    const value = ctx[key];
    return value != null ? String(value) : '';
  });
}

function rowToTemplateContext(row) {
  const emAberto = valorEmAberto(row);
  const empresa = String(row.participante_nome || '').trim();
  const contatoNome = String(row.contato_nome || '').trim();
  return {
    nome: contatoNome,
    empresa,
    tipo: tipoLabel(row.tipo),
    espaco: espacoLabel(row),
    grupo: row.grupo_nome || '',
    instagram: row.instagram || '',
    telefone: row.contato_telefone || '',
    contato: contatoNome,
    descricao: row.descricao || '',
    cota: row.descricao || row.produto_nome || '',
    produto: row.produto_nome || '',
    status: row.status || '',
    valor_total: formatBRL(row.valor_total),
    valor_pago: formatBRL(row.valor_pago),
    valor_em_aberto: formatBRL(emAberto),
    evento: row.evento_nome || '',
    _valor_em_aberto_num: emAberto,
  };
}

function displayDestinatarioLabel(vars) {
  const empresa = String(vars.empresa || '').trim();
  const contato = String(vars.nome || vars.contato || '').trim();
  if (empresa && contato && empresa !== contato) return `${empresa} · ${contato}`;
  return empresa || contato || '';
}

function parseTiposFilter(raw) {
  const list = Array.isArray(raw?.tipos)
    ? raw.tipos
    : Array.isArray(raw?.tiposLead)
      ? raw.tiposLead
      : [];
  const tipos = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => VALID_TIPOS.has(t)))];
  return tipos.length ? tipos : [...VALID_TIPOS];
}

function parseFiltros(raw) {
  const data = raw?.filtros && typeof raw.filtros === 'object' ? raw.filtros : raw;
  const somenteComSaldo =
    data?.somenteComSaldo !== undefined
      ? Boolean(data.somenteComSaldo)
      : data?.somente_com_saldo !== undefined
        ? Boolean(data.somente_com_saldo)
        : true;
  const status = Array.isArray(data?.status)
    ? data.status.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return { somenteComSaldo, status };
}

function pickLeadPerPhone(rows) {
  const byPhone = new Map();
  for (const row of rows) {
    const phoneKey = toWhatsAppNumber(row.contato_telefone);
    if (!phoneKey) continue;
    const prev = byPhone.get(phoneKey);
    if (!prev) {
      byPhone.set(phoneKey, row);
      continue;
    }
    const prevPri = TIPO_PRIORITY[prev.tipo] ?? 99;
    const nextPri = TIPO_PRIORITY[row.tipo] ?? 99;
    if (nextPri < prevPri || (nextPri === prevPri && row.id < prev.id)) {
      byPhone.set(phoneKey, row);
    }
  }
  return [...byPhone.values()].sort((a, b) =>
    String(a.participante_nome || '').localeCompare(String(b.participante_nome || ''), 'pt-BR', {
      sensitivity: 'base',
    }),
  );
}

const LEAD_COMUNICACAO_SQL = `
  SELECT a.id, a.participante_id, a.tipo, a.status, a.descricao,
         a.valor_total, a.valor_pago,
         p.nome AS participante_nome, p.instagram, p.contato_nome, p.contato_telefone,
         e.numero AS espaco_numero, e.label AS espaco_label,
         ge.nome AS grupo_nome, ge.slug AS grupo_slug,
         ap.nome AS produto_nome,
         ev.nome AS evento_nome
  FROM arrecadacao a
  JOIN participantes p ON p.id = a.participante_id
  JOIN eventos ev ON ev.id = a.evento_id
  LEFT JOIN espacos e ON e.id = a.espaco_id
  LEFT JOIN grupos_espacos ge ON ge.id = e.grupo_id
  LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id`;

async function queryLeadsForComunicacao(pool, eventoId, tipos, filtros) {
  const placeholders = tipos.map(() => '?').join(', ');
  const params = [eventoId, ...tipos];
  let statusSql = '';
  if (filtros.status?.length) {
    statusSql = ` AND a.status IN (${filtros.status.map(() => '?').join(', ')})`;
    params.push(...filtros.status);
  }

  const [rows] = await pool.query(
    `${LEAD_COMUNICACAO_SQL}
     WHERE a.evento_id = ?
       AND a.tipo IN (${placeholders})
       AND TRIM(p.contato_telefone) <> ''
       ${statusSql}
     ORDER BY p.nome ASC, a.tipo ASC, a.id ASC`,
    params,
  );

  return rows
    .filter((row) => hasValidPhone(row.contato_telefone))
    .filter((row) => !filtros.somenteComSaldo || valorEmAberto(row) > 0);
}

async function queryLeadByArrecadacaoId(pool, eventoId, arrecadacaoId) {
  const [rows] = await pool.query(
    `${LEAD_COMUNICACAO_SQL}
     WHERE a.evento_id = ? AND a.id = ?
     LIMIT 1`,
    [eventoId, arrecadacaoId],
  );
  return rows[0] || null;
}

function rowToPreviewItem(row, template) {
  const vars = rowToTemplateContext(row);
  const emAberto = vars._valor_em_aberto_num;
  delete vars._valor_em_aberto_num;
  return {
    arrecadacaoId: Number(row.id),
    participanteId: Number(row.participante_id),
    nome: vars.empresa || displayDestinatarioLabel(vars),
    contatoNome: vars.nome || vars.contato || '',
    telefone: vars.telefone,
    tipo: row.tipo,
    tipoLabel: vars.tipo,
    mensagem: renderComunicacaoTemplate(template, vars),
    incluido: emAberto > 0 || !template.includes('valor_em_aberto'),
    vars,
    valorEmAberto: emAberto,
  };
}

function rowToComunicacao(row) {
  return {
    id: Number(row.id),
    eventoId: Number(row.evento_id),
    nome: row.nome,
    template: row.template || '',
    tipos: parseJson(row.tipos, []),
    filtros: parseJson(row.filtros, { somenteComSaldo: true, status: [] }),
    intervaloMin: Number(row.intervalo_min || 15),
    intervaloMax: Number(row.intervalo_max || 45),
    status: row.status || 'rascunho',
    totalDestinatarios: Number(row.total_destinatarios || 0),
    totalEnviados: Number(row.total_enviados || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function rowToComunicacaoItem(row) {
  return {
    id: Number(row.id),
    comunicacaoId: Number(row.comunicacao_id),
    arrecadacaoId: Number(row.arrecadacao_id),
    nome: row.nome || '',
    contatoNome: row.contato_nome || '',
    telefone: row.telefone || '',
    tipo: row.tipo || '',
    tipoLabel: tipoLabel(row.tipo),
    mensagem: row.mensagem || '',
    incluido: Boolean(row.incluido),
    pausado: Boolean(row.pausado),
    status: row.status || 'pendente',
    erroMsg: row.erro_msg || '',
    enviadoEm: row.enviado_em ? new Date(row.enviado_em).toISOString() : null,
    valorEmAberto: row.valor_em_aberto != null ? Number(row.valor_em_aberto) : null,
  };
}

export async function migrateComunicacoes(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_comunicacoes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      nome VARCHAR(160) NOT NULL,
      template TEXT NOT NULL,
      tipos JSON NOT NULL,
      filtros JSON NULL,
      intervalo_min INT UNSIGNED NOT NULL DEFAULT 15,
      intervalo_max INT UNSIGNED NOT NULL DEFAULT 45,
      status VARCHAR(24) NOT NULL DEFAULT 'rascunho',
      total_destinatarios INT UNSIGNED NOT NULL DEFAULT 0,
      total_enviados INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_mcom_evento (evento_id, updated_at),
      CONSTRAINT fk_mcom_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_comunicacao_itens (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      comunicacao_id INT UNSIGNED NOT NULL,
      arrecadacao_id INT UNSIGNED NOT NULL,
      nome VARCHAR(160) NOT NULL,
      contato_nome VARCHAR(160) NULL,
      telefone VARCHAR(40) NOT NULL,
      tipo VARCHAR(24) NOT NULL,
      mensagem TEXT NOT NULL,
      valor_em_aberto DECIMAL(12, 2) NULL,
      incluido TINYINT(1) NOT NULL DEFAULT 1,
      status VARCHAR(24) NOT NULL DEFAULT 'pendente',
      erro_msg TEXT NULL,
      enviado_em DATETIME(3) NULL,
      mensagem_id INT UNSIGNED NULL,
      INDEX idx_mci_comunicacao (comunicacao_id, status),
      INDEX idx_mci_arrecadacao (arrecadacao_id),
      CONSTRAINT fk_mci_comunicacao FOREIGN KEY (comunicacao_id) REFERENCES marketing_comunicacoes(id) ON DELETE CASCADE,
      CONSTRAINT fk_mci_arrecadacao FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const stmt of [
    `ALTER TABLE marketing_comunicacao_itens ADD COLUMN enviado_em DATETIME(3) NULL AFTER erro_msg`,
    `ALTER TABLE marketing_comunicacao_itens ADD COLUMN mensagem_id INT UNSIGNED NULL AFTER enviado_em`,
    `ALTER TABLE marketing_comunicacao_itens ADD COLUMN contato_nome VARCHAR(160) NULL AFTER nome`,
    `ALTER TABLE marketing_comunicacao_itens ADD COLUMN pausado TINYINT(1) NOT NULL DEFAULT 0 AFTER incluido`,
  ]) {
    try {
      await pool.query(stmt);
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  await pool.query(
    `UPDATE marketing_comunicacoes SET status = 'preview'
     WHERE status IN ('enviando', 'pausado')`,
  );
}

async function findComunicacaoRow(pool, id, eventoId) {
  const [rows] = await pool.query(
    'SELECT * FROM marketing_comunicacoes WHERE id = ? AND evento_id = ? LIMIT 1',
    [id, eventoId],
  );
  return rows[0] || null;
}

export async function listComunicacoes(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM marketing_comunicacao_itens i WHERE i.comunicacao_id = c.id AND i.incluido = 1) AS itens_ativos,
            (SELECT COUNT(*) FROM marketing_comunicacao_itens i WHERE i.comunicacao_id = c.id AND i.status = 'enviado') AS itens_enviados
     FROM marketing_comunicacoes c
     WHERE c.evento_id = ?
     ORDER BY c.updated_at DESC, c.id DESC`,
    [eventoId],
  );
  return rows.map((row) => ({
    ...rowToComunicacao(row),
    itensAtivos: Number(row.itens_ativos || 0),
    itensEnviados: Number(row.itens_enviados || 0),
  }));
}

export async function getComunicacaoById(pool, id, eventoId) {
  const row = await findComunicacaoRow(pool, id, eventoId);
  if (!row) return null;

  const [itens] = await pool.query(
    `SELECT * FROM marketing_comunicacao_itens
     WHERE comunicacao_id = ?
     ORDER BY nome ASC, id ASC`,
    [id],
  );

  return {
    comunicacao: rowToComunicacao(row),
    itens: itens.map(rowToComunicacaoItem),
  };
}

export async function createComunicacao(pool, eventoId, body) {
  const nome = String(body?.nome || '').trim() || 'Nova comunicação';
  const template = String(body?.template || body?.mensagem || '').trim();
  const tipos = parseTiposFilter(body);
  const filtros = parseFiltros(body);
  const intervaloMin = Math.min(Math.max(Number(body?.intervaloMin ?? body?.intervalo_min) || 15, 5), 600);
  let intervaloMax = Math.min(Math.max(Number(body?.intervaloMax ?? body?.intervalo_max) || 45, 5), 600);
  if (intervaloMin > intervaloMax) intervaloMax = intervaloMin;

  const [result] = await pool.query(
    `INSERT INTO marketing_comunicacoes
       (evento_id, nome, template, tipos, filtros, intervalo_min, intervalo_max, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', CURRENT_TIMESTAMP(3))`,
    [
      eventoId,
      nome,
      template,
      JSON.stringify(tipos),
      JSON.stringify(filtros),
      intervaloMin,
      intervaloMax,
    ],
  );

  return getComunicacaoById(pool, result.insertId, eventoId);
}

export async function updateComunicacao(pool, id, eventoId, body) {
  const existing = await findComunicacaoRow(pool, id, eventoId);
  if (!existing) return null;

  const nome = body?.nome !== undefined ? String(body.nome).trim() || existing.nome : existing.nome;
  const template =
    body?.template !== undefined || body?.mensagem !== undefined
      ? String(body.template ?? body.mensagem ?? '').trim()
      : existing.template;
  const tipos = body?.tipos !== undefined ? parseTiposFilter(body) : parseJson(existing.tipos, []);
  const filtros =
    body?.filtros !== undefined ? parseFiltros(body) : parseJson(existing.filtros, { somenteComSaldo: true, status: [] });
  const intervaloMin =
    body?.intervaloMin !== undefined || body?.intervalo_min !== undefined
      ? Math.min(Math.max(Number(body.intervaloMin ?? body.intervalo_min) || 15, 5), 600)
      : Number(existing.intervalo_min || 15);
  let intervaloMax =
    body?.intervaloMax !== undefined || body?.intervalo_max !== undefined
      ? Math.min(Math.max(Number(body.intervaloMax ?? body.intervalo_max) || 45, 5), 600)
      : Number(existing.intervalo_max || 45);
  if (intervaloMin > intervaloMax) intervaloMax = intervaloMin;

  await pool.query(
    `UPDATE marketing_comunicacoes SET
       nome = ?, template = ?, tipos = ?, filtros = ?, intervalo_min = ?, intervalo_max = ?,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [nome, template, JSON.stringify(tipos), JSON.stringify(filtros), intervaloMin, intervaloMax, id, eventoId],
  );

  await refreshComunicacaoCounts(pool, id);

  return getComunicacaoById(pool, id, eventoId);
}

export async function deleteComunicacao(pool, id, eventoId) {
  const existing = await findComunicacaoRow(pool, id, eventoId);
  if (!existing) return false;
  await pool.query('DELETE FROM marketing_comunicacoes WHERE id = ? AND evento_id = ?', [id, eventoId]);
  return true;
}

export async function gerarPreviewComunicacao(pool, id, eventoId) {
  const row = await findComunicacaoRow(pool, id, eventoId);
  if (!row) return null;

  const template = String(row.template || '').trim();
  if (!template) {
    throw Object.assign(new Error('Informe o template da mensagem antes de gerar a prévia'), { status: 400 });
  }

  const tipos = parseTiposFilter({ tipos: parseJson(row.tipos, []) });
  const filtros = parseFiltros({ filtros: parseJson(row.filtros, {}) });
  const rows = pickLeadPerPhone(await queryLeadsForComunicacao(pool, eventoId, tipos, filtros));
  const items = rows.map((r) => rowToPreviewItem(r, template));

  const [sentRows] = await pool.query(
    `SELECT arrecadacao_id FROM marketing_comunicacao_itens
     WHERE comunicacao_id = ? AND status IN ('enviado', 'reenvio_pendente')`,
    [id],
  );
  const sentArrecadacaoIds = new Set(sentRows.map((r) => Number(r.arrecadacao_id)));

  await pool.query(
    `DELETE FROM marketing_comunicacao_itens WHERE comunicacao_id = ? AND status NOT IN ('enviado', 'reenvio_pendente')`,
    [id],
  );

  for (const item of items) {
    if (sentArrecadacaoIds.has(item.arrecadacaoId)) continue;
    const incluido = item.incluido ? 1 : 0;
    const status = item.incluido ? 'pendente' : 'ignorado';
    await pool.query(
      `INSERT INTO marketing_comunicacao_itens
         (comunicacao_id, arrecadacao_id, nome, contato_nome, telefone, tipo, mensagem, valor_em_aberto, incluido, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        item.arrecadacaoId,
        item.nome,
        item.contatoNome || null,
        item.telefone,
        item.tipo,
        item.mensagem,
        item.valorEmAberto,
        incluido,
        status,
      ],
    );
  }

  await refreshComunicacaoCounts(pool, id);

  return getComunicacaoById(pool, id, eventoId);
}

export async function updateComunicacaoItem(pool, comunicacaoId, itemId, eventoId, body) {
  const com = await findComunicacaoRow(pool, comunicacaoId, eventoId);
  if (!com) return null;

  const [rows] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ? LIMIT 1',
    [itemId, comunicacaoId],
  );
  if (!rows[0]) return null;

  const mensagem =
    body?.mensagem !== undefined || body?.texto !== undefined
      ? String(body.mensagem ?? body.texto ?? '').trim()
      : rows[0].mensagem;
  if (!mensagem) {
    throw Object.assign(new Error('Informe o texto da mensagem'), { status: 400 });
  }

  const incluido =
    body?.incluido !== undefined ? (body.incluido ? 1 : 0) : rows[0].incluido ? 1 : 0;
  const status = incluido
    ? rows[0].status === 'enviado' || rows[0].status === 'reenvio_pendente'
      ? rows[0].status
      : 'pendente'
    : 'ignorado';

  await pool.query(
    `UPDATE marketing_comunicacao_itens SET mensagem = ?, incluido = ?, status = ? WHERE id = ?`,
    [mensagem, incluido, status, itemId],
  );

  const [counts] = await pool.query(
    `SELECT
       SUM(incluido = 1) AS ativos,
       SUM(status = 'enviado') AS enviados
     FROM marketing_comunicacao_itens WHERE comunicacao_id = ?`,
    [comunicacaoId],
  );
  await pool.query(
    `UPDATE marketing_comunicacoes SET
       total_destinatarios = ?, total_enviados = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [Number(counts[0]?.ativos || 0), Number(counts[0]?.enviados || 0), comunicacaoId],
  );

  const [updated] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? LIMIT 1',
    [itemId],
  );
  return rowToComunicacaoItem(updated[0]);
}

export async function atualizarConteudoComunicacaoItem(pool, comunicacaoId, itemId, eventoId) {
  const com = await findComunicacaoRow(pool, comunicacaoId, eventoId);
  if (!com) return null;

  const template = String(com.template || '').trim();
  if (!template) {
    throw Object.assign(new Error('Informe o template da mensagem'), { status: 400 });
  }

  const [itemRows] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ? LIMIT 1',
    [itemId, comunicacaoId],
  );
  if (!itemRows[0]) return null;

  const lead = await queryLeadByArrecadacaoId(pool, eventoId, itemRows[0].arrecadacao_id);
  if (!lead) {
    throw Object.assign(new Error('Lead não encontrado neste evento'), { status: 404 });
  }

  const preview = rowToPreviewItem(lead, template);
  const nextStatus =
    itemRows[0].status === 'enviado' || itemRows[0].status === 'reenvio_pendente'
      ? 'reenvio_pendente'
      : itemRows[0].status;
  await pool.query(
    `UPDATE marketing_comunicacao_itens SET
       nome = ?, contato_nome = ?, telefone = ?, tipo = ?, mensagem = ?, valor_em_aberto = ?, status = ?
     WHERE id = ? AND comunicacao_id = ?`,
    [
      preview.nome,
      preview.contatoNome || null,
      preview.telefone,
      preview.tipo,
      preview.mensagem,
      preview.valorEmAberto,
      nextStatus,
      itemId,
      comunicacaoId,
    ],
  );

  await refreshComunicacaoCounts(pool, comunicacaoId);

  const [updated] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? LIMIT 1',
    [itemId],
  );
  return rowToComunicacaoItem(updated[0]);
}

export async function setComunicacaoItemPausado(pool, comunicacaoId, itemId, eventoId, pausado) {
  const com = await findComunicacaoRow(pool, comunicacaoId, eventoId);
  if (!com) return null;

  const [rows] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ? LIMIT 1',
    [itemId, comunicacaoId],
  );
  if (!rows[0]) return null;
  if (rows[0].status === 'enviado') {
    throw Object.assign(new Error('Destinatários já enviados não podem ser pausados'), { status: 409 });
  }

  const nextPausado = pausado !== undefined ? (pausado ? 1 : 0) : rows[0].pausado ? 0 : 1;
  await pool.query(
    `UPDATE marketing_comunicacao_itens SET pausado = ? WHERE id = ? AND comunicacao_id = ?`,
    [nextPausado, itemId, comunicacaoId],
  );

  await refreshComunicacaoCounts(pool, comunicacaoId);

  const [updated] = await pool.query(
    'SELECT * FROM marketing_comunicacao_itens WHERE id = ? LIMIT 1',
    [itemId],
  );
  return rowToComunicacaoItem(updated[0]);
}

async function refreshComunicacaoCounts(pool, comunicacaoId) {
  const [counts] = await pool.query(
    `SELECT
       SUM(incluido = 1) AS ativos,
       SUM(status = 'enviado') AS enviados,
       COUNT(*) AS total
     FROM marketing_comunicacao_itens WHERE comunicacao_id = ?`,
    [comunicacaoId],
  );
  const ativos = Number(counts[0]?.ativos || 0);
  const enviados = Number(counts[0]?.enviados || 0);
  const total = Number(counts[0]?.total || 0);
  const [pendingRows] = await pool.query(
    `SELECT COUNT(*) AS pendentes FROM marketing_comunicacao_itens
     WHERE comunicacao_id = ? AND incluido = 1 AND pausado = 0
       AND status IN ('pendente', 'erro', 'reenvio_pendente')`,
    [comunicacaoId],
  );
  const pendentes = Number(pendingRows[0]?.pendentes || 0);
  const [comRows] = await pool.query(
    'SELECT status FROM marketing_comunicacoes WHERE id = ? LIMIT 1',
    [comunicacaoId],
  );
  let status = comRows[0]?.status || 'rascunho';
  if (total === 0) {
    status = 'rascunho';
  } else if (pendentes === 0 && ativos > 0 && enviados >= ativos) {
    status = 'concluido';
  } else {
    status = 'preview';
  }
  await pool.query(
    `UPDATE marketing_comunicacoes SET
       total_destinatarios = ?, total_enviados = ?, status = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [ativos, enviados, status, comunicacaoId],
  );
}

export async function deleteComunicacaoItem(pool, comunicacaoId, itemId, eventoId) {
  const com = await findComunicacaoRow(pool, comunicacaoId, eventoId);
  if (!com) return null;

  const [rows] = await pool.query(
    'SELECT id, status FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ? LIMIT 1',
    [itemId, comunicacaoId],
  );
  if (!rows[0]) return null;
  if (rows[0].status === 'enviado' || rows[0].status === 'reenvio_pendente') {
    throw Object.assign(new Error('Destinatários já enviados não podem ser removidos'), { status: 409 });
  }

  await pool.query('DELETE FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ?', [
    itemId,
    comunicacaoId,
  ]);
  await refreshComunicacaoCounts(pool, comunicacaoId);
  return getComunicacaoById(pool, comunicacaoId, eventoId);
}

export async function limparPreviewComunicacao(pool, id, eventoId) {
  const com = await findComunicacaoRow(pool, id, eventoId);
  if (!com) return null;

  await pool.query('DELETE FROM marketing_comunicacao_itens WHERE comunicacao_id = ?', [id]);
  await pool.query(
    `UPDATE marketing_comunicacoes SET
       status = 'rascunho', total_destinatarios = 0, total_enviados = 0, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND evento_id = ?`,
    [id, eventoId],
  );
  return getComunicacaoById(pool, id, eventoId);
}

export async function previewComunicacao(pool, eventoId, body) {
  const template = String(body?.template || body?.mensagem || '').trim();
  if (!template) {
    throw Object.assign(new Error('Informe o template da mensagem'), { status: 400 });
  }

  const tipos = parseTiposFilter(body);
  const filtros = parseFiltros(body);
  const rows = pickLeadPerPhone(await queryLeadsForComunicacao(pool, eventoId, tipos, filtros));
  const items = rows
    .map((row) => rowToPreviewItem(row, template))
    .filter((item) => item.incluido);

  return {
    variaveis: COMUNICACAO_TEMPLATE_VARS,
    tipos,
    filtros,
    total: items.length,
    items,
  };
}

export async function enviarComunicacaoItem(pool, eventoId, body) {
  const arrecadacaoId = Number(body?.arrecadacaoId ?? body?.arrecadacao_id);
  const itemId = Number(body?.itemId ?? body?.item_id ?? body?.comunicacaoItemId);
  const comunicacaoId = Number(body?.comunicacaoId ?? body?.comunicacao_id);
  const text = String((body?.texto ?? body?.text ?? body?.mensagem) || '').trim();

  if (!arrecadacaoId) {
    throw Object.assign(new Error('Informe o destinatário'), { status: 400 });
  }
  if (!text) {
    throw Object.assign(new Error('Informe a mensagem'), { status: 400 });
  }

  const [rows] = await pool.query(
    `SELECT a.id, p.contato_telefone
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.id = ? AND a.evento_id = ?
     LIMIT 1`,
    [arrecadacaoId, eventoId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error('Lead não encontrado neste evento'), { status: 404 });
  }
  if (!hasValidPhone(rows[0].contato_telefone)) {
    throw Object.assign(new Error('Lead sem WhatsApp válido'), { status: 400 });
  }

  const status = await getWhatsappStatusQuick();
  if (!status.configured) {
    throw Object.assign(new Error('Evolution API não configurada no servidor'), { status: 503 });
  }
  if (!status.connected) {
    throw Object.assign(new Error('WhatsApp não conectado. Conecte antes de disparar.'), { status: 503 });
  }

  try {
    if (itemId && comunicacaoId) {
      await pool.query(
        `UPDATE marketing_comunicacao_itens SET mensagem = ? WHERE id = ? AND comunicacao_id = ?`,
        [text, itemId, comunicacaoId],
      );
    }

    const result = await sendWhatsappToLead(pool, arrecadacaoId, text);
    const enviadoEm =
      result.mensagem?.enviadoEm != null
        ? new Date(result.mensagem.enviadoEm)
        : new Date();

    if (itemId && comunicacaoId) {
      await pool.query(
        `UPDATE marketing_comunicacao_itens SET
           status = 'enviado', erro_msg = NULL, enviado_em = ?, mensagem = ?, mensagem_id = ?
         WHERE id = ? AND comunicacao_id = ?`,
        [enviadoEm, text, result.mensagem?.id ?? null, itemId, comunicacaoId],
      );
      await refreshComunicacaoCounts(pool, comunicacaoId);
    }

    let item = null;
    if (itemId && comunicacaoId) {
      const [updated] = await pool.query(
        'SELECT * FROM marketing_comunicacao_itens WHERE id = ? AND comunicacao_id = ? LIMIT 1',
        [itemId, comunicacaoId],
      );
      if (updated[0]) item = rowToComunicacaoItem(updated[0]);
    }

    return {
      ok: true,
      arrecadacaoId,
      itemId: itemId || null,
      item,
      mensagemId: result.mensagem?.id ?? null,
      evolutionMessageId: result.mensagem?.evolutionMessageId ?? null,
      enviadoEm: result.mensagem?.enviadoEm ?? enviadoEm.toISOString(),
      evolution: result.evolution ?? null,
    };
  } catch (err) {
    if (itemId && comunicacaoId) {
      await pool.query(
        `UPDATE marketing_comunicacao_itens SET status = 'erro', erro_msg = ? WHERE id = ? AND comunicacao_id = ?`,
        [String(err.message || 'Falha no envio').slice(0, 500), itemId, comunicacaoId],
      );
    }
    throw err;
  }
}

export async function marcarComunicacaoEnviando(pool, id, eventoId) {
  const row = await findComunicacaoRow(pool, id, eventoId);
  if (!row) return null;
  if (row.status !== 'preview' && row.status !== 'pausado' && row.status !== 'enviando') {
    throw Object.assign(
      new Error('Gere a prévia da comunicação antes de iniciar o disparo'),
      { status: 400 },
    );
  }

  const [counts] = await pool.query(
    `SELECT COUNT(*) AS pendentes FROM marketing_comunicacao_itens
     WHERE comunicacao_id = ? AND incluido = 1 AND pausado = 0
       AND status IN ('pendente', 'erro', 'reenvio_pendente')`,
    [id],
  );
  if (!Number(counts[0]?.pendentes)) {
    throw Object.assign(new Error('Não há destinatários pendentes nesta comunicação'), { status: 400 });
  }

  return getComunicacaoById(pool, id, eventoId);
}

export async function pausarComunicacao(pool, id, eventoId) {
  const row = await findComunicacaoRow(pool, id, eventoId);
  if (!row) return null;
  await refreshComunicacaoCounts(pool, id);
  return getComunicacaoById(pool, id, eventoId);
}
