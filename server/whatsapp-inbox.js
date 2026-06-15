import { attachReactionsToMensagens, syncWhatsappHistory, backfillReactionsForParticipante } from './whatsapp.js';
import { midiaUrlForMensagemRow, backfillWhatsappMediaForParticipante } from './whatsapp-media.js';

function queueParticipanteMediaBackfill(pool, eventoId, participanteId) {
  void import('./whatsapp.js')
    .then(({ runWhatsappMediaBackfill }) =>
      runWhatsappMediaBackfill(pool, { eventoId, participanteId, limit: 5 }),
    )
    .catch(() => {});
}

function rowToMensagem(row) {
  return {
    id: row.id,
    arrecadacaoId: Number(row.arrecadacao_id),
    evolutionMessageId: row.evolution_message_id,
    remoteJid: row.remote_jid,
    direcao: row.direcao,
    tipo: row.tipo,
    texto: row.texto || '',
    midiaUrl: midiaUrlForMensagemRow(row),
    midiaMimetype: row.midia_mimetype || null,
    enviadoEm: row.enviado_em ? new Date(row.enviado_em).toISOString() : null,
    criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : null,
    reacoes: [],
  };
}

export async function listWhatsappInbox(pool, eventoId) {
  const [rows] = await pool.query(
    `SELECT
       p.id AS participante_id,
       p.nome AS participante_nome,
       p.contato_telefone,
       MIN(a.id) AS primary_arrecadacao_id,
       GROUP_CONCAT(DISTINCT a.id ORDER BY a.id) AS arrecadacao_ids,
       COUNT(DISTINCT w.evolution_message_id) AS total_mensagens,
       MAX(w.enviado_em) AS ultima_mensagem_em
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     LEFT JOIN whatsapp_mensagens w ON w.arrecadacao_id = a.id
       AND w.tipo <> 'reaction'
       AND NOT (w.tipo = 'unknown' AND w.texto = '[Mensagem não suportada]')
     WHERE a.evento_id = ? AND TRIM(p.contato_telefone) <> ''
     GROUP BY p.id, p.nome, p.contato_telefone
     ORDER BY MAX(w.enviado_em) IS NULL, MAX(w.enviado_em) DESC, p.nome ASC`,
    [eventoId],
  );

  if (!rows.length) return [];

  const participanteIds = rows.map((r) => r.participante_id);
  const placeholders = participanteIds.map(() => '?').join(', ');
  const [lastMsgs] = await pool.query(
    `SELECT w.arrecadacao_id, w.direcao, w.tipo, w.texto, w.enviado_em, a.participante_id
     FROM whatsapp_mensagens w
     JOIN arrecadacao a ON a.id = w.arrecadacao_id
     JOIN (
       SELECT a2.participante_id,
              SUBSTRING_INDEX(
                GROUP_CONCAT(w2.id ORDER BY w2.enviado_em DESC, w2.id DESC),
                ',',
                1
              ) AS max_id
       FROM whatsapp_mensagens w2
       JOIN arrecadacao a2 ON a2.id = w2.arrecadacao_id
       WHERE a2.evento_id = ?
         AND a2.participante_id IN (${placeholders})
         AND w2.tipo <> 'reaction'
         AND NOT (w2.tipo = 'unknown' AND w2.texto = '[Mensagem não suportada]')
       GROUP BY a2.participante_id
     ) latest ON latest.max_id = w.id
     WHERE a.evento_id = ?`,
    [eventoId, ...participanteIds, eventoId],
  );

  const lastByParticipante = new Map();
  for (const row of lastMsgs) {
    if (!lastByParticipante.has(row.participante_id)) {
      lastByParticipante.set(row.participante_id, row);
    }
  }

  return rows.map((row) => {
    const last = lastByParticipante.get(row.participante_id);
    return {
      participanteId: Number(row.participante_id),
      participanteNome: row.participante_nome,
      telefone: row.contato_telefone || '',
      primaryArrecadacaoId: Number(row.primary_arrecadacao_id),
      arrecadacaoIds: String(row.arrecadacao_ids || '')
        .split(',')
        .map((id) => Number(id))
        .filter((id) => id > 0),
      totalMensagens: Number(row.total_mensagens || 0),
      ultimaMensagem: last
        ? {
            texto: last.texto || '',
            direcao: last.direcao,
            tipo: last.tipo,
            enviadoEm: last.enviado_em ? new Date(last.enviado_em).toISOString() : null,
          }
        : null,
    };
  });
}

export async function listMessagesForParticipante(pool, eventoId, participanteId, { limit = 500 } = {}) {
  const max = Math.min(Math.max(limit, 1), 500);
  const [rows] = await pool.query(
    `SELECT recent.id, recent.arrecadacao_id, recent.evolution_message_id, recent.remote_jid,
            recent.direcao, recent.tipo, recent.texto, recent.midia_url, recent.midia_mimetype,
            recent.midia_storage_path, recent.enviado_em, recent.criado_em
     FROM (
       SELECT w.id, w.arrecadacao_id, w.evolution_message_id, w.remote_jid, w.direcao, w.tipo, w.texto,
              w.midia_url, w.midia_mimetype, w.midia_storage_path, w.enviado_em, w.criado_em
       FROM whatsapp_mensagens w
       JOIN arrecadacao a ON a.id = w.arrecadacao_id
       JOIN (
         SELECT w2.evolution_message_id, MAX(w2.id) AS max_id
         FROM whatsapp_mensagens w2
         JOIN arrecadacao a2 ON a2.id = w2.arrecadacao_id
         WHERE a2.evento_id = ? AND a2.participante_id = ?
           AND w2.tipo <> 'reaction'
           AND NOT (w2.tipo = 'unknown' AND w2.texto = '[Mensagem não suportada]')
         GROUP BY w2.evolution_message_id
       ) dedup ON dedup.max_id = w.id
       WHERE a.evento_id = ? AND a.participante_id = ?
       ORDER BY w.enviado_em DESC, w.id DESC
       LIMIT ?
     ) recent
     ORDER BY recent.enviado_em ASC, recent.id ASC`,
    [eventoId, participanteId, eventoId, participanteId, max],
  );
  const mensagens = rows.map(rowToMensagem);
  queueParticipanteMediaBackfill(pool, eventoId, participanteId);
  return attachReactionsToMensagens(pool, mensagens);
}

export async function getPrimaryArrecadacaoId(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT id FROM arrecadacao
     WHERE evento_id = ? AND participante_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [eventoId, participanteId],
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

async function getArrecadacaoIdsForParticipante(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT id FROM arrecadacao
     WHERE evento_id = ? AND participante_id = ?
     ORDER BY id ASC`,
    [eventoId, participanteId],
  );
  return rows.map((row) => Number(row.id));
}

async function countPendingMediaForParticipante(pool, eventoId, participanteId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM whatsapp_mensagens wm
     JOIN arrecadacao a ON a.id = wm.arrecadacao_id
     WHERE a.evento_id = ? AND a.participante_id = ?
       AND wm.tipo IN ('image', 'audio', 'video', 'document', 'sticker')
       AND wm.midia_storage_path IS NULL`,
    [eventoId, participanteId],
  );
  return Number(rows[0]?.c || 0);
}

export async function syncInboxParticipante(pool, eventoId, participanteId, { days = 5 } = {}) {
  const arrecadacaoId = await getPrimaryArrecadacaoId(pool, eventoId, participanteId);
  if (!arrecadacaoId) {
    throw Object.assign(new Error('Lead não encontrado para este contato'), { status: 404 });
  }

  const arrecadacaoIds = await getArrecadacaoIdsForParticipante(pool, eventoId, participanteId);

  await pool.query(
    `UPDATE whatsapp_mensagens wm
     JOIN arrecadacao a ON a.id = wm.arrecadacao_id
     SET wm.midia_mirror_erro = NULL
     WHERE a.evento_id = ? AND a.participante_id = ?
       AND wm.tipo IN ('image', 'audio', 'video', 'document', 'sticker')
       AND (wm.midia_storage_path IS NULL OR wm.midia_storage_path LIKE 'file:%')`,
    [eventoId, participanteId],
  );

  const errors = [];
  let history = null;
  let reactions = null;
  let media = null;

  try {
    history = await syncWhatsappHistory(pool, arrecadacaoId, {
      days,
      mediaBackfillLimit: 50,
      maxPages: 15,
      pageSize: 100,
      arrecadacaoIds,
    });
  } catch (err) {
    errors.push(err.message || 'Falha ao sincronizar histórico');
  }

  try {
    reactions = await backfillReactionsForParticipante(pool, eventoId, participanteId, {
      days,
      maxReactions: 200,
      maxPages: 30,
    });
  } catch (err) {
    errors.push(err.message || 'Falha ao sincronizar reações');
  }

  try {
    media = await backfillWhatsappMediaForParticipante(pool, eventoId, participanteId, {
      limit: 80,
      order: 'desc',
    });
  } catch (err) {
    errors.push(err.message || 'Falha ao baixar mídias');
  }

  const pendingMedia = await countPendingMediaForParticipante(pool, eventoId, participanteId);
  const mensagens = await listMessagesForParticipante(pool, eventoId, participanteId);

  return {
    ok: errors.length === 0,
    days,
    history,
    reactions,
    media: media ? { ...media, pending: pendingMedia } : { mirrored: 0, failed: 0, total: 0, pending: pendingMedia },
    mensagens,
    errors,
  };
}
