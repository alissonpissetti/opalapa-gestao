import {
  attachReactionsToMensagens,
  syncWhatsappHistory,
  backfillReactionsForParticipante,
  backfillReactionsForLead,
  getWhatsappStatus,
  runWhatsappMediaBackfill,
  getLatestWhatsappMessageTimestamp,
  getLatestWhatsappMessageTimestampForParticipante,
} from './whatsapp.js';
import {
  midiaUrlForMensagemRow,
  midiaPreviewUrlForMensagemRow,
  backfillWhatsappMediaForParticipante,
} from './whatsapp-media.js';
import { listFunilEtapas, etapaByStatus } from './funil.js';

const prepareCache = new Map();
const PREPARE_COOLDOWN_MS = 45000;

function queueParticipanteMediaBackfill(pool, eventoId, participanteId) {
  void runWhatsappMediaBackfill(pool, { eventoId, participanteId, limit: 40 });
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
    midiaPreviewUrl: midiaPreviewUrlForMensagemRow(row),
    midiaFileSize: row.midia_file_size ? Number(row.midia_file_size) : null,
    midiaPageCount: row.midia_page_count ? Number(row.midia_page_count) : null,
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
       SUBSTRING_INDEX(GROUP_CONCAT(a.status ORDER BY a.id), ',', 1) AS lead_status,
       SUBSTRING_INDEX(GROUP_CONCAT(a.tipo ORDER BY a.id), ',', 1) AS lead_tipo,
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

  const [etapasComercial, etapasArtistico] = await Promise.all([
    listFunilEtapas(pool, eventoId, { escopo: 'comercial' }),
    listFunilEtapas(pool, eventoId, { escopo: 'artistico' }),
  ]);

  return rows.map((row) => {
    const last = lastByParticipante.get(row.participante_id);
    const leadTipo = row.lead_tipo || '';
    const leadStatus = row.lead_status || '';
    const etapas = leadTipo === 'artistico' ? etapasArtistico : etapasComercial;
    const etapa = etapaByStatus(etapas, leadStatus);
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
      leadTipo,
      leadStatus,
      etapaFunil: etapa
        ? {
            titulo: etapa.titulo,
            cor: etapa.cor,
            status: etapa.status,
            tipo: etapa.tipo,
          }
        : leadStatus
          ? { titulo: leadStatus, cor: null, status: leadStatus, tipo: 'normal' }
          : null,
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

export async function listMessagesForParticipante(
  pool,
  eventoId,
  participanteId,
  { limit = 500, prepare = false, days = 7 } = {},
) {
  if (prepare) {
    await prepareWhatsappConversation(pool, { eventoId, participanteId, days });
  } else {
    queueParticipanteMediaBackfill(pool, eventoId, participanteId);
  }

  const max = Math.min(Math.max(limit, 1), 500);
  const [rows] = await pool.query(
    `SELECT recent.id, recent.arrecadacao_id, recent.evolution_message_id, recent.remote_jid,
            recent.direcao, recent.tipo, recent.texto, recent.midia_url, recent.midia_mimetype,
            recent.midia_storage_path, recent.midia_preview_path, recent.midia_file_size,
            recent.midia_page_count, recent.enviado_em, recent.criado_em
     FROM (
       SELECT w.id, w.arrecadacao_id, w.evolution_message_id, w.remote_jid, w.direcao, w.tipo, w.texto,
              w.midia_url, w.midia_mimetype, w.midia_storage_path, w.midia_preview_path,
              w.midia_file_size, w.midia_page_count, w.enviado_em, w.criado_em
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
       AND (wm.midia_storage_path IS NULL OR wm.midia_mirror_erro IS NOT NULL)`,
    [eventoId, participanteId],
  );
  return Number(rows[0]?.c || 0);
}

async function countPendingMediaForLead(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM whatsapp_mensagens
     WHERE arrecadacao_id = ?
       AND tipo IN ('image', 'audio', 'video', 'document', 'sticker')
       AND (midia_storage_path IS NULL OR midia_mirror_erro IS NOT NULL)`,
    [arrecadacaoId],
  );
  return Number(rows[0]?.c || 0);
}

async function clearMediaMirrorErrors(pool, { eventoId, participanteId, arrecadacaoId } = {}) {
  if (eventoId && participanteId) {
    await pool.query(
      `UPDATE whatsapp_mensagens wm
       JOIN arrecadacao a ON a.id = wm.arrecadacao_id
       SET wm.midia_mirror_erro = NULL
       WHERE a.evento_id = ? AND a.participante_id = ?
         AND wm.tipo IN ('image', 'audio', 'video', 'document', 'sticker')
         AND (wm.midia_storage_path IS NULL OR wm.midia_storage_path LIKE 'file:%')`,
      [eventoId, participanteId],
    );
    return;
  }

  if (arrecadacaoId) {
    await pool.query(
      `UPDATE whatsapp_mensagens
       SET midia_mirror_erro = NULL
       WHERE arrecadacao_id = ?
         AND tipo IN ('image', 'audio', 'video', 'document', 'sticker')
         AND (midia_storage_path IS NULL OR midia_storage_path LIKE 'file:%')`,
      [arrecadacaoId],
    );
  }
}

export async function prepareWhatsappConversation(
  pool,
  { eventoId, participanteId, arrecadacaoId, days = 7, force = false } = {},
) {
  const status = await getWhatsappStatus();
  if (!status.connected) {
    return { skipped: true, reason: 'disconnected' };
  }

  let resolvedArrecadacaoId = arrecadacaoId ? Number(arrecadacaoId) : null;
  if (!resolvedArrecadacaoId && eventoId && participanteId) {
    resolvedArrecadacaoId = await getPrimaryArrecadacaoId(pool, eventoId, participanteId);
  }
  if (!resolvedArrecadacaoId) {
    return { skipped: true, reason: 'no_lead' };
  }

  const cacheKey =
    eventoId && participanteId ? `${eventoId}:${participanteId}` : `lead:${resolvedArrecadacaoId}`;
  const lastPrepared = prepareCache.get(cacheKey) || 0;
  const skipHistory = !force && Date.now() - lastPrepared < PREPARE_COOLDOWN_MS;

  await clearMediaMirrorErrors(pool, { eventoId, participanteId, arrecadacaoId: resolvedArrecadacaoId });

  if (skipHistory) {
    const pendingEarly =
      eventoId && participanteId
        ? await countPendingMediaForParticipante(pool, eventoId, participanteId)
        : await countPendingMediaForLead(pool, resolvedArrecadacaoId);
    if (pendingEarly === 0) {
      return {
        ok: true,
        skipped: true,
        skipHistory: true,
        days,
        media: { mirrored: 0, failed: 0, pending: 0 },
        errors: [],
      };
    }
  }

  const errors = [];
  let history = null;
  let reactions = null;
  let mediaMirrored = 0;
  let mediaFailed = 0;

  if (!skipHistory) {
    const arrecadacaoIds =
      eventoId && participanteId
        ? await getArrecadacaoIdsForParticipante(pool, eventoId, participanteId)
        : [resolvedArrecadacaoId];

    const hasLocalMessages =
      eventoId && participanteId
        ? Boolean(
            await getLatestWhatsappMessageTimestampForParticipante(pool, eventoId, participanteId),
          )
        : Boolean(await getLatestWhatsappMessageTimestamp(pool, resolvedArrecadacaoId));

    try {
      history = await syncWhatsappHistory(pool, resolvedArrecadacaoId, {
        days,
        mediaBackfillLimit: hasLocalMessages ? 30 : 120,
        maxPages: hasLocalMessages ? 5 : 20,
        pageSize: 100,
        arrecadacaoIds,
        eventoId,
        participanteId,
      });
    } catch (err) {
      errors.push(err.message || 'Falha ao sincronizar histórico');
    }

    if (!history?.incremental) {
      try {
        if (eventoId && participanteId) {
          reactions = await backfillReactionsForParticipante(pool, eventoId, participanteId, {
            days,
            maxReactions: 200,
            maxPages: 30,
          });
        } else {
          reactions = await backfillReactionsForLead(pool, resolvedArrecadacaoId, {
            days,
            maxReactions: 200,
          });
        }
      } catch (err) {
        errors.push(err.message || 'Falha ao sincronizar reações');
      }
    }
  }

  const lightMedia = Boolean(history?.incremental || skipHistory);
  const mediaRounds = lightMedia ? 3 : 12;
  const mediaBatchLimit = lightMedia ? 25 : 80;
  for (let round = 0; round < mediaRounds; round += 1) {
    if (eventoId && participanteId) {
      const batch = await backfillWhatsappMediaForParticipante(pool, eventoId, participanteId, {
        limit: mediaBatchLimit,
      });
      mediaMirrored += batch.mirrored || 0;
      mediaFailed += batch.failed || 0;
      if ((batch.mirrored || 0) === 0 && (batch.total || 0) === 0) break;
      if ((batch.mirrored || 0) === 0 && round >= 1) break;
    } else {
      const mirrored = await runWhatsappMediaBackfill(pool, {
        arrecadacaoId: resolvedArrecadacaoId,
        limit: mediaBatchLimit,
      });
      mediaMirrored += mirrored;
      if (!mirrored) break;
    }
  }

  const pendingMedia =
    eventoId && participanteId
      ? await countPendingMediaForParticipante(pool, eventoId, participanteId)
      : await countPendingMediaForLead(pool, resolvedArrecadacaoId);

  prepareCache.set(cacheKey, Date.now());

  return {
    ok: errors.length === 0,
    skipped: false,
    skipHistory,
    days,
    history,
    reactions,
    media: { mirrored: mediaMirrored, failed: mediaFailed, pending: pendingMedia },
    errors,
  };
}

export async function syncInboxParticipante(pool, eventoId, participanteId, { days = 5 } = {}) {
  const arrecadacaoId = await getPrimaryArrecadacaoId(pool, eventoId, participanteId);
  if (!arrecadacaoId) {
    throw Object.assign(new Error('Lead não encontrado para este contato'), { status: 404 });
  }

  const prepared = await prepareWhatsappConversation(pool, {
    eventoId,
    participanteId,
    days,
    force: true,
  });
  const mensagens = await listMessagesForParticipante(pool, eventoId, participanteId, {
    prepare: false,
  });

  return {
    ok: prepared.ok,
    days,
    history: prepared.history,
    reactions: prepared.reactions,
    media: prepared.media,
    mensagens,
    errors: prepared.errors || [],
  };
}
