import { toWhatsAppNumber } from './whatsapp-phone.js';
import { sendWhatsappToLead, getWhatsappStatusQuick } from './whatsapp.js';

const TIPO_LABELS = {
  espaco: 'Espaço',
  patrocinio: 'Patrocínio',
  artistico: 'Artístico',
  contato: 'Contato',
};

const TIPO_PRIORITY = { espaco: 0, patrocinio: 1, artistico: 2, contato: 3 };

export const COMUNICACAO_TEMPLATE_VARS = [
  { key: 'nome', label: 'Nome do participante' },
  { key: 'tipo', label: 'Tipo do lead (Espaço, Patrocínio…)' },
  { key: 'espaco', label: 'Espaço vinculado (rótulo ou número)' },
  { key: 'grupo', label: 'Grupo do espaço' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'telefone', label: 'Telefone / WhatsApp' },
  { key: 'contato', label: 'Nome do contato' },
  { key: 'descricao', label: 'Descrição do lead' },
  { key: 'status', label: 'Etapa do funil (status)' },
];

const VALID_TIPOS = new Set(Object.keys(TIPO_LABELS));

function tipoLabel(tipo) {
  return TIPO_LABELS[tipo] || tipo || '';
}

function espacoLabel(row) {
  if (row.espaco_label) return String(row.espaco_label);
  if (row.espaco_numero != null) return `Espaço ${row.espaco_numero}`;
  return '';
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
  return {
    nome: row.participante_nome || '',
    tipo: tipoLabel(row.tipo),
    espaco: espacoLabel(row),
    grupo: row.grupo_nome || '',
    instagram: row.instagram || '',
    telefone: row.contato_telefone || '',
    contato: row.contato_nome || '',
    descricao: row.descricao || '',
    status: row.status || '',
  };
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

async function queryLeadsForComunicacao(pool, eventoId, tipos) {
  const placeholders = tipos.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT a.id, a.participante_id, a.tipo, a.status, a.descricao,
            p.nome AS participante_nome, p.instagram, p.contato_nome, p.contato_telefone,
            e.numero AS espaco_numero, e.label AS espaco_label,
            ge.nome AS grupo_nome, ge.slug AS grupo_slug
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     LEFT JOIN espacos e ON e.id = a.espaco_id
     LEFT JOIN grupos_espacos ge ON ge.id = e.grupo_id
     WHERE a.evento_id = ?
       AND a.tipo IN (${placeholders})
       AND TRIM(p.contato_telefone) <> ''
     ORDER BY p.nome ASC, a.tipo ASC, a.id ASC`,
    [eventoId, ...tipos],
  );
  return rows.filter((row) => hasValidPhone(row.contato_telefone));
}

function rowToPreviewItem(row, template) {
  const vars = rowToTemplateContext(row);
  return {
    arrecadacaoId: Number(row.id),
    participanteId: Number(row.participante_id),
    nome: vars.nome,
    telefone: vars.telefone,
    tipo: row.tipo,
    tipoLabel: vars.tipo,
    mensagem: renderComunicacaoTemplate(template, vars),
    vars,
  };
}

export async function previewComunicacao(pool, eventoId, body) {
  const template = String(body?.template || body?.mensagem || '').trim();
  if (!template) {
    throw Object.assign(new Error('Informe o template da mensagem'), { status: 400 });
  }

  const tipos = parseTiposFilter(body);
  const rows = pickLeadPerPhone(await queryLeadsForComunicacao(pool, eventoId, tipos));
  const items = rows.map((row) => rowToPreviewItem(row, template));

  return {
    variaveis: COMUNICACAO_TEMPLATE_VARS,
    tipos,
    total: items.length,
    items,
  };
}

export async function enviarComunicacaoItem(pool, eventoId, body) {
  const arrecadacaoId = Number(body?.arrecadacaoId ?? body?.arrecadacao_id);
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

  const result = await sendWhatsappToLead(pool, arrecadacaoId, text);
  return {
    ok: true,
    arrecadacaoId,
    mensagemId: result.mensagem?.id ?? null,
  };
}
