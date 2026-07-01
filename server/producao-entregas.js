import { BENEFICIOS_DEF, BENEFICIOS_UNIVERSAIS } from './arrecadacao-produtos.js';
import { listFunilEtapas, vendaEtapa } from './funil.js';

const BENEFICIO_KEYS = new Set(BENEFICIOS_DEF.map((b) => b.key));
const UNIVERSAL_BENEFICIO_KEYS = new Set(BENEFICIOS_UNIVERSAIS);

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

function groupRowsToEntregas(rows) {
  const byParticipante = new Map();
  for (const row of rows) {
    const pid = row.participante_id;
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
    const beneficiosConcluidos = {};
    for (const key of BENEFICIO_KEYS) beneficiosConcluidos[key] = false;

    let updatedAt = null;
    for (const row of groupRows) {
      if (Boolean(row.envio_marca)) envioMarca = true;
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

    const ingressosRaw = primary.ingressos_cortesia;
    const ingressosCortesia =
      ingressosRaw != null && Number.isFinite(Number(ingressosRaw))
        ? Math.max(0, Math.floor(Number(ingressosRaw)))
        : 0;

    items.push({
      arrecadacaoId: Number(primary.arrecadacao_id),
      participanteId: Number(participanteId),
      participanteNome: primary.participante_nome || '',
      produtoId: primary.produto_id != null ? Number(primary.produto_id) : null,
      produtoNome: primary.produto_nome || '',
      produtoOrdem: produtoOrdem(primary),
      espacosLabels,
      espacos: espacosLabels.join(' · '),
      ingressosCortesia,
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
         pe.envio_marca, pe.ingressos_cortesia, pe.beneficios_concluidos, pe.updated_at AS entrega_updated_at
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
  return Boolean(rows[0]);
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
    'SELECT envio_marca, ingressos_cortesia, beneficios_concluidos FROM producao_entregas WHERE arrecadacao_id = ?',
    [primaryId],
  );
  const current = currentRows[0];
  let envioMarca = Boolean(current?.envio_marca);
  let ingressosCortesia =
    current?.ingressos_cortesia != null && Number.isFinite(Number(current.ingressos_cortesia))
      ? Math.max(0, Math.floor(Number(current.ingressos_cortesia)))
      : 0;
  let beneficiosConcluidos = normalizeBeneficiosConcluidos(current?.beneficios_concluidos);

  if (raw.envioMarca !== undefined || raw.envio_marca !== undefined) {
    envioMarca = Boolean(raw.envioMarca ?? raw.envio_marca);
  }

  if (raw.ingressosCortesia !== undefined || raw.ingressos_cortesia !== undefined) {
    const val = raw.ingressosCortesia ?? raw.ingressos_cortesia;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      throw Object.assign(new Error('Quantidade de ingressos cortesia inválida'), { status: 400 });
    }
    ingressosCortesia = Math.min(65535, Math.floor(n));
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

  await pool.query(
    `UPDATE producao_entregas
     SET envio_marca = ?, ingressos_cortesia = ?, beneficios_concluidos = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE arrecadacao_id = ?`,
    [envioMarca ? 1 : 0, ingressosCortesia, JSON.stringify(beneficiosConcluidos), primaryId],
  );

  const etapas = await listFunilEtapas(pool, eventoId, { escopo: 'comercial' });
  const statuses = vendaStatuses(etapas);
  const [partRows] = await pool.query(
    'SELECT participante_id FROM arrecadacao WHERE id = ? LIMIT 1',
    [primaryId],
  );
  const participanteId = partRows[0]?.participante_id;
  if (participanteId == null) return null;

  const groupRows = await fetchClosedLeadsForParticipante(pool, eventoId, participanteId, statuses);
  const grouped = groupRowsToEntregas(groupRows);
  return grouped[0] || null;
}
