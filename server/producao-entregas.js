import {
  BENEFICIOS_DEF,
  BENEFICIOS_UNIVERSAIS,
  CAMISETA_TAMANHOS,
  inferIngressosPadraoFromNome,
} from './arrecadacao-produtos.js';
import { listFunilEtapas, vendaEtapa } from './funil.js';

const BENEFICIO_KEYS = new Set(BENEFICIOS_DEF.map((b) => b.key));
const UNIVERSAL_BENEFICIO_KEYS = new Set(BENEFICIOS_UNIVERSAIS);

function parseJsonArray(value, fallback = []) {
  if (value == null || value === '') return [...fallback];
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [...fallback];
    } catch {
      return [...fallback];
    }
  }
  return [...fallback];
}

function parseIngressosPadrao(value, nomeFallback = '') {
  if (value == null || value === '') return inferIngressosPadraoFromNome(nomeFallback);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return inferIngressosPadraoFromNome(nomeFallback);
  return Math.min(255, Math.floor(n));
}

function normalizeCamisetasTamanhos(raw, camisetasCount) {
  const count = Math.max(0, Math.floor(Number(camisetasCount) || 0));
  const allowed = new Set(CAMISETA_TAMANHOS);
  const arr = parseJsonArray(raw).map((item) => String(item || '').trim().toUpperCase());
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const size = arr[i] || '';
    out.push(size && allowed.has(size) ? size : '');
  }
  return out;
}

function resolveIngressosSolicitados(row) {
  const padrao = parseIngressosPadrao(row.produto_ingressos_padrao, row.produto_nome);
  if (row.ingressos_solicitados != null && Number.isFinite(Number(row.ingressos_solicitados))) {
    return {
      padrao,
      solicitados: Math.max(0, Math.floor(Number(row.ingressos_solicitados))),
      personalizado: true,
    };
  }
  const legacy = row.ingressos_cortesia;
  if (legacy != null && Number.isFinite(Number(legacy)) && Number(legacy) > 0) {
    return {
      padrao,
      solicitados: Math.max(0, Math.floor(Number(legacy))),
      personalizado: true,
    };
  }
  return { padrao, solicitados: padrao, personalizado: false };
}

function inferCamisetasPadrao(beneficiosAtivos, ingressosPadraoPlano) {
  if (!beneficiosAtivos?.logo_camisetas) return 0;
  return ingressosPadraoPlano;
}

function resolveCamisetasSolicitadas(row, ingressosPadraoPlano, ingressosEfetivos, beneficiosAtivos) {
  const padrao = inferCamisetasPadrao(beneficiosAtivos, ingressosPadraoPlano);
  if (row.camisetas_solicitadas != null && Number.isFinite(Number(row.camisetas_solicitadas))) {
    return {
      padrao,
      solicitados: Math.max(0, Math.floor(Number(row.camisetas_solicitadas))),
      personalizado: true,
    };
  }
  return { padrao, solicitados: ingressosEfetivos, personalizado: false };
}

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return { ...fallback };
  if (typeof value === 'object' && !Array.isArray(value)) return { ...fallback, ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)
        ? { ...fallback, ...parsed }
        : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }
  return { ...fallback };
}

function normalizeBeneficiosConcluidos(raw) {
  const input = parseJsonObject(raw);
  const out = {};
  for (const key of BENEFICIO_KEYS) {
    if (input[key] != null) out[key] = Boolean(input[key]);
  }
  return out;
}

function normalizePlanoBeneficios(raw) {
  const input = parseJsonObject(raw);
  const out = {};
  for (const key of BENEFICIO_KEYS) {
    out[key] = Boolean(input[key]);
  }
  return out;
}

function vendaStatuses(etapas) {
  const set = new Set(['vend']);
  for (const e of etapas) {
    if (e.tipo === 'venda' && e.ativo !== false) set.add(e.status);
  }
  return [...set];
}

function formatEspacoLabel(row) {
  if (row.espaco_numero == null) return '';
  const grupo = row.espaco_grupo_slug ? `${row.espaco_grupo_slug} · ` : '';
  const tipo = row.espaco_tipo ? ` (${row.espaco_tipo})` : '';
  return `${grupo}Espaço ${row.espaco_numero}${tipo}`;
}

function produtoOrdem(row) {
  const n = Number(row.produto_ordem);
  return Number.isFinite(n) ? n : 999;
}

function pickPrimaryRow(rows) {
  const patrocinios = rows.filter((r) => r.tipo === 'patrocinio');
  const pool = patrocinios.length ? patrocinios : rows;
  return [...pool].sort(
    (a, b) =>
      produtoOrdem(b) - produtoOrdem(a) ||
      Number(a.arrecadacao_id) - Number(b.arrecadacao_id),
  )[0];
}

function applyBeneficiosUniversaisAtivos(beneficiosAtivos) {
  const out = { ...beneficiosAtivos };
  for (const key of BENEFICIOS_UNIVERSAIS) {
    out[key] = true;
  }
  return out;
}

function computeBeneficiosColunas(rows) {
  const used = new Set(BENEFICIOS_UNIVERSAIS);
  for (const row of rows) {
    const ben = normalizePlanoBeneficios(row.produto_beneficios);
    for (const def of BENEFICIOS_DEF) {
      if (ben[def.key]) used.add(def.key);
    }
  }
  if (!used.size) {
    return BENEFICIOS_DEF.map((d) => d.key);
  }
  return BENEFICIOS_DEF.filter((d) => used.has(d.key)).map((d) => d.key);
}

function normalizeParticipanteId(pid) {
  if (pid == null) return null;
  const n = Number(pid);
  return Number.isFinite(n) ? n : null;
}

function groupRowsToEntregas(rows) {
  const byParticipante = new Map();
  for (const row of rows) {
    const pid = normalizeParticipanteId(row.participante_id);
    if (pid == null) continue;
    if (!byParticipante.has(pid)) byParticipante.set(pid, []);
    byParticipante.get(pid).push(row);
  }

  const items = [];
  for (const [participanteId, groupRows] of byParticipante) {
    const primary = pickPrimaryRow(groupRows);
    const planoBeneficios = normalizePlanoBeneficios(primary.produto_beneficios);

    const beneficiosAtivos = applyBeneficiosUniversaisAtivos(
      Object.fromEntries(
        [...BENEFICIO_KEYS].map((key) => [key, Boolean(planoBeneficios[key])]),
      ),
    );

    let envioMarca = false;
    let envioIngressos = false;
    const beneficiosConcluidos = {};
    for (const key of BENEFICIO_KEYS) beneficiosConcluidos[key] = false;

    let updatedAt = null;
    for (const row of groupRows) {
      if (Boolean(row.envio_marca)) envioMarca = true;
      if (Boolean(row.envio_ingressos)) envioIngressos = true;
      const concl = normalizeBeneficiosConcluidos(row.beneficios_concluidos);
      for (const key of BENEFICIO_KEYS) {
        if (concl[key]) beneficiosConcluidos[key] = true;
      }
      if (row.entrega_updated_at) {
        const ts = new Date(row.entrega_updated_at).getTime();
        if (!updatedAt || ts > new Date(updatedAt).getTime()) {
          updatedAt = new Date(row.entrega_updated_at).toISOString();
        }
      }
    }

    const espacosLabels = groupRows
      .map(formatEspacoLabel)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const ingressosInfo = resolveIngressosSolicitados(primary);
    const camisetasInfo = resolveCamisetasSolicitadas(
      primary,
      ingressosInfo.padrao,
      ingressosInfo.solicitados,
      beneficiosAtivos,
    );
    const camisetasTamanhos = normalizeCamisetasTamanhos(
      primary.camisetas_tamanhos,
      camisetasInfo.solicitados,
    );

    items.push({
      arrecadacaoId: Number(primary.arrecadacao_id),
      participanteId: Number(participanteId),
      participanteNome: primary.participante_nome || '',
      produtoId: primary.produto_id != null ? Number(primary.produto_id) : null,
      produtoNome: primary.produto_nome || '',
      produtoOrdem: produtoOrdem(primary),
      espacosLabels,
      espacos: espacosLabels.join(' · '),
      ingressosPadrao: ingressosInfo.padrao,
      ingressosSolicitados: ingressosInfo.solicitados,
      ingressosPersonalizado: ingressosInfo.personalizado,
      ingressosCortesia: ingressosInfo.solicitados,
      camisetasPadrao: camisetasInfo.padrao,
      camisetasSolicitadas: camisetasInfo.solicitados,
      camisetasPersonalizado: camisetasInfo.personalizado,
      camisetasTamanhos,
      envioIngressos,
      envioMarca,
      beneficiosAtivos,
      beneficiosConcluidos,
      updatedAt,
    });
  }

  items.sort(
    (a, b) =>
      a.produtoOrdem - b.produtoOrdem ||
      a.participanteNome.localeCompare(b.participanteNome, 'pt-BR'),
  );

  return items;
}

const ENTREGAS_SELECT = `
  SELECT a.id AS arrecadacao_id, a.participante_id, a.tipo, a.status, a.produto_id,
         p.nome AS participante_nome,
         e.tipo AS espaco_tipo, e.numero AS espaco_numero,
         ge.slug AS espaco_grupo_slug,
         ap.nome AS produto_nome, ap.ordem AS produto_ordem, ap.beneficios AS produto_beneficios,
         ap.ingressos_padrao AS produto_ingressos_padrao,
         pe.envio_marca, pe.envio_ingressos, pe.ingressos_cortesia, pe.ingressos_solicitados,
         pe.camisetas_solicitadas, pe.camisetas_tamanhos,
         pe.beneficios_concluidos, pe.updated_at AS entrega_updated_at
  FROM arrecadacao a
  JOIN participantes p ON p.id = a.participante_id
  LEFT JOIN espacos e ON e.id = a.espaco_id
  LEFT JOIN grupos_espacos ge ON ge.id = e.grupo_id
  LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
  LEFT JOIN producao_entregas pe ON pe.arrecadacao_id = a.id`;

export async function migrateProducaoEntregas(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS producao_entregas (
      arrecadacao_id INT UNSIGNED NOT NULL PRIMARY KEY,
      envio_marca TINYINT(1) NOT NULL DEFAULT 0,
      ingressos_cortesia SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      beneficios_concluidos JSON NOT NULL,
      updated_at DATETIME(3) NULL,
      CONSTRAINT fk_producao_entregas_arrecadacao
        FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producao_entregas'`,
  );
  const colSet = new Set(cols.map((c) => c.name));
  if (!colSet.has('ingressos_cortesia')) {
    await pool.query(
      'ALTER TABLE producao_entregas ADD COLUMN ingressos_cortesia SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER envio_marca',
    );
  }
  if (!colSet.has('ingressos_solicitados')) {
    await pool.query(
      'ALTER TABLE producao_entregas ADD COLUMN ingressos_solicitados SMALLINT UNSIGNED NULL AFTER ingressos_cortesia',
    );
    await pool.query(
      `UPDATE producao_entregas SET ingressos_solicitados = ingressos_cortesia WHERE ingressos_cortesia > 0`,
    );
  }
  if (!colSet.has('camisetas_tamanhos')) {
    await pool.query(
      "ALTER TABLE producao_entregas ADD COLUMN camisetas_tamanhos JSON NULL AFTER ingressos_solicitados",
    );
  }
  if (!colSet.has('envio_ingressos')) {
    await pool.query(
      'ALTER TABLE producao_entregas ADD COLUMN envio_ingressos TINYINT(1) NOT NULL DEFAULT 0 AFTER envio_marca',
    );
  }
  if (!colSet.has('camisetas_solicitadas')) {
    await pool.query(
      'ALTER TABLE producao_entregas ADD COLUMN camisetas_solicitadas SMALLINT UNSIGNED NULL AFTER ingressos_solicitados',
    );
  }
}

async function ensureEntregaRow(pool, arrecadacaoId) {
  await pool.query(
    `INSERT IGNORE INTO producao_entregas (arrecadacao_id, envio_marca, beneficios_concluidos)
     VALUES (?, 0, '{}')`,
    [arrecadacaoId],
  );
}

async function isArrecadacaoFechada(pool, eventoId, arrecadacaoId) {
  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const statuses = vendaStatuses(etapas);
  const placeholders = statuses.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT id FROM arrecadacao
     WHERE id = ? AND evento_id = ? AND tipo IN ('espaco', 'patrocinio')
       AND status IN (${placeholders})
     LIMIT 1`,
    [arrecadacaoId, eventoId, ...statuses],
  );
  if (rows[0]) return true;

  const [partRows] = await pool.query(
    `SELECT participante_id FROM arrecadacao
     WHERE id = ? AND evento_id = ? AND tipo IN ('espaco', 'patrocinio')
     LIMIT 1`,
    [arrecadacaoId, eventoId],
  );
  const participanteId = normalizeParticipanteId(partRows[0]?.participante_id);
  if (participanteId == null) return false;

  const groupRows = await fetchClosedLeadsForParticipante(
    pool,
    eventoId,
    participanteId,
    statuses,
  );
  return groupRows.length > 0;
}

async function syncEnvioFlagsForParticipanteGroup(
  pool,
  groupRows,
  primaryId,
  { envioMarca, envioIngressos },
) {
  const siblingIds = groupRows
    .map((r) => Number(r.arrecadacao_id))
    .filter((id) => Number.isFinite(id) && id !== primaryId);
  for (const sibId of siblingIds) {
    await ensureEntregaRow(pool, sibId);
  }
  if (!siblingIds.length) return;
  const placeholders = siblingIds.map(() => '?').join(', ');
  await pool.query(
    `UPDATE producao_entregas
     SET envio_marca = ?, envio_ingressos = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE arrecadacao_id IN (${placeholders})`,
    [envioMarca ? 1 : 0, envioIngressos ? 1 : 0, ...siblingIds],
  );
}

async function fetchClosedLeadsForParticipante(pool, eventoId, participanteId, statuses) {
  const placeholders = statuses.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `${ENTREGAS_SELECT}
     WHERE a.evento_id = ? AND a.participante_id = ?
       AND a.tipo IN ('espaco', 'patrocinio')
       AND a.status IN (${placeholders})
     ORDER BY ap.ordem ASC, a.id ASC`,
    [eventoId, participanteId, ...statuses],
  );
  return rows;
}

async function resolvePrimaryArrecadacaoId(pool, eventoId, arrecadacaoId) {
  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const statuses = vendaStatuses(etapas);

  const [partRows] = await pool.query(
    `SELECT participante_id FROM arrecadacao WHERE id = ? AND evento_id = ? LIMIT 1`,
    [arrecadacaoId, eventoId],
  );
  const participanteId = partRows[0]?.participante_id;
  if (participanteId == null) return arrecadacaoId;

  const rows = await fetchClosedLeadsForParticipante(pool, eventoId, participanteId, statuses);
  if (!rows.length) return arrecadacaoId;
  return Number(pickPrimaryRow(rows).arrecadacao_id);
}

export async function listProducaoEntregas(pool, eventoId, { produtoId } = {}) {
  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const statuses = vendaStatuses(etapas);
  const venda = vendaEtapa(etapas);

  const placeholders = statuses.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `${ENTREGAS_SELECT}
     WHERE a.evento_id = ?
       AND a.tipo IN ('espaco', 'patrocinio')
       AND a.status IN (${placeholders})
     ORDER BY ap.ordem ASC, ap.nome ASC, p.nome ASC, a.id ASC`,
    [eventoId, ...statuses],
  );

  let items = groupRowsToEntregas(rows);

  if (produtoId != null && produtoId !== '') {
    const id = Number(produtoId);
    if (Number.isInteger(id) && id > 0) {
      items = items.filter((item) => item.produtoId === id);
    }
  }

  return {
    items,
    beneficiosColunas: computeBeneficiosColunas(rows),
    beneficiosDef: BENEFICIOS_DEF,
    beneficiosUniversais: BENEFICIOS_UNIVERSAIS,
    camisetaTamanhos: CAMISETA_TAMANHOS,
    vendaEtapaTitulo: venda?.titulo || 'Fechado',
  };
}

export async function patchProducaoEntrega(pool, arrecadacaoId, eventoId, raw) {
  const ok = await isArrecadacaoFechada(pool, eventoId, arrecadacaoId);
  if (!ok) {
    throw Object.assign(new Error('Lead não encontrado ou ainda não está fechado'), { status: 404 });
  }

  const primaryId = await resolvePrimaryArrecadacaoId(pool, eventoId, arrecadacaoId);
  await ensureEntregaRow(pool, primaryId);

  const [currentRows] = await pool.query(
    `SELECT envio_marca, envio_ingressos, ingressos_cortesia, ingressos_solicitados,
            camisetas_solicitadas, camisetas_tamanhos, beneficios_concluidos
     FROM producao_entregas WHERE arrecadacao_id = ?`,
    [primaryId],
  );
  const [prodMetaRows] = await pool.query(
    `SELECT ap.ingressos_padrao, ap.nome AS produto_nome, ap.beneficios
     FROM arrecadacao a
     LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
     WHERE a.id = ? AND a.evento_id = ?
     LIMIT 1`,
    [primaryId, eventoId],
  );
  const prodMeta = prodMetaRows[0] || {};
  const ingressosPadraoPlano = parseIngressosPadrao(
    prodMeta.ingressos_padrao,
    prodMeta.produto_nome,
  );
  const current = currentRows[0];
  let envioMarca = Boolean(current?.envio_marca);
  let envioIngressos = Boolean(current?.envio_ingressos);
  let ingressosSolicitados = current?.ingressos_solicitados;
  let ingressosPersonalizado = ingressosSolicitados != null;
  let ingressosEfetivos = ingressosPersonalizado
    ? Math.max(0, Math.floor(Number(ingressosSolicitados)))
    : ingressosPadraoPlano;
  let camisetasSolicitadas = current?.camisetas_solicitadas;
  let camisetasPersonalizado = camisetasSolicitadas != null;
  let camisetasEfetivos = camisetasPersonalizado
    ? Math.max(0, Math.floor(Number(camisetasSolicitadas)))
    : ingressosEfetivos;
  let camisetasTamanhos = normalizeCamisetasTamanhos(
    current?.camisetas_tamanhos,
    camisetasEfetivos,
  );
  let beneficiosConcluidos = normalizeBeneficiosConcluidos(current?.beneficios_concluidos);

  function syncCamisetasTamanhosLength() {
    camisetasTamanhos = normalizeCamisetasTamanhos(camisetasTamanhos, camisetasEfetivos);
  }

  if (raw.envioMarca !== undefined || raw.envio_marca !== undefined) {
    envioMarca = Boolean(raw.envioMarca ?? raw.envio_marca);
  }

  if (raw.envioIngressos !== undefined || raw.envio_ingressos !== undefined) {
    envioIngressos = Boolean(raw.envioIngressos ?? raw.envio_ingressos);
  }

  if (
    raw.ingressosSolicitados !== undefined ||
    raw.ingressos_solicitados !== undefined ||
    raw.ingressosCortesia !== undefined ||
    raw.ingressos_cortesia !== undefined
  ) {
    const val =
      raw.ingressosSolicitados ??
      raw.ingressos_solicitados ??
      raw.ingressosCortesia ??
      raw.ingressos_cortesia;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      throw Object.assign(new Error('Quantidade de ingressos solicitados inválida'), { status: 400 });
    }
    ingressosEfetivos = Math.min(255, Math.floor(n));
    ingressosSolicitados = ingressosEfetivos;
    ingressosPersonalizado = true;
    if (!camisetasPersonalizado) {
      camisetasEfetivos = ingressosEfetivos;
      syncCamisetasTamanhosLength();
    }
  }

  if (raw.ingressosUsarPadrao === true || raw.ingressos_usar_padrao === true) {
    ingressosSolicitados = null;
    ingressosPersonalizado = false;
    ingressosEfetivos = ingressosPadraoPlano;
    if (!camisetasPersonalizado) {
      camisetasEfetivos = ingressosEfetivos;
      syncCamisetasTamanhosLength();
    }
  }

  if (
    raw.camisetasSolicitadas !== undefined ||
    raw.camisetas_solicitadas !== undefined
  ) {
    const val = raw.camisetasSolicitadas ?? raw.camisetas_solicitadas;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      throw Object.assign(new Error('Quantidade de camisetas solicitadas inválida'), { status: 400 });
    }
    camisetasEfetivos = Math.min(255, Math.floor(n));
    camisetasSolicitadas = camisetasEfetivos;
    camisetasPersonalizado = true;
    syncCamisetasTamanhosLength();
  }

  if (raw.camisetasUsarPadrao === true || raw.camisetas_usar_padrao === true) {
    camisetasSolicitadas = null;
    camisetasPersonalizado = false;
    camisetasEfetivos = ingressosEfetivos;
    syncCamisetasTamanhosLength();
  }

  if (raw.camisetasTamanhos !== undefined || raw.camisetas_tamanhos !== undefined) {
    camisetasTamanhos = normalizeCamisetasTamanhos(
      raw.camisetasTamanhos ?? raw.camisetas_tamanhos,
      camisetasEfetivos,
    );
  }

  const beneficioKey = raw.beneficio ?? raw.beneficioKey ?? raw.beneficio_key;
  if (beneficioKey != null && beneficioKey !== '') {
    const key = String(beneficioKey).trim();
    if (!BENEFICIO_KEYS.has(key)) {
      throw Object.assign(new Error('Benefício inválido'), { status: 400 });
    }

    const [prodRows] = await pool.query(
      `SELECT ap.beneficios
       FROM arrecadacao a
       LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
       WHERE a.id = ? AND a.evento_id = ?
       LIMIT 1`,
      [primaryId, eventoId],
    );
    const planoBeneficios = normalizePlanoBeneficios(prodRows[0]?.beneficios);
    if (!planoBeneficios[key] && !UNIVERSAL_BENEFICIO_KEYS.has(key)) {
      throw Object.assign(new Error('Este benefício não faz parte do plano do lead'), { status: 400 });
    }

    const concluido = raw.concluido ?? raw.concluidoBeneficio ?? raw.checked;
    if (concluido === undefined) {
      beneficiosConcluidos[key] = !beneficiosConcluidos[key];
    } else {
      beneficiosConcluidos[key] = Boolean(concluido);
    }
  }

  const ingressosCortesia = ingressosEfetivos;

  const touchedEnvioFlags =
    raw.envioMarca !== undefined ||
    raw.envio_marca !== undefined ||
    raw.envioIngressos !== undefined ||
    raw.envio_ingressos !== undefined;

  await pool.query(
    `UPDATE producao_entregas
     SET envio_marca = ?, envio_ingressos = ?, ingressos_cortesia = ?, ingressos_solicitados = ?,
         camisetas_solicitadas = ?, camisetas_tamanhos = ?, beneficios_concluidos = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE arrecadacao_id = ?`,
    [
      envioMarca ? 1 : 0,
      envioIngressos ? 1 : 0,
      ingressosCortesia,
      ingressosPersonalizado ? ingressosSolicitados : null,
      camisetasPersonalizado ? camisetasSolicitadas : null,
      JSON.stringify(camisetasTamanhos),
      JSON.stringify(beneficiosConcluidos),
      primaryId,
    ],
  );

  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const statuses = vendaStatuses(etapas);
  const [partRows] = await pool.query(
    'SELECT participante_id FROM arrecadacao WHERE id = ? LIMIT 1',
    [primaryId],
  );
  const participanteId = normalizeParticipanteId(partRows[0]?.participante_id);
  if (participanteId == null) return null;

  let groupRows = await fetchClosedLeadsForParticipante(pool, eventoId, participanteId, statuses);
  if (touchedEnvioFlags) {
    await syncEnvioFlagsForParticipanteGroup(pool, groupRows, primaryId, {
      envioMarca,
      envioIngressos,
    });
    groupRows = await fetchClosedLeadsForParticipante(pool, eventoId, participanteId, statuses);
  }

  const grouped = groupRowsToEntregas(groupRows);
  const participanteItem = grouped.find((g) => g.participanteId === participanteId);
  return participanteItem || grouped[0] || null;
}
