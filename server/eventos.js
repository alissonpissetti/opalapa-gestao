import { ensureGruposForEvento } from './grupos.js';
import { seedEspacosForEvento } from './espacos.js';

function rowToEvento(row) {
  return {
    id: row.id,
    nome: row.nome || '',
    edicao: row.edicao != null ? Number(row.edicao) : null,
    eventoAnteriorId: row.evento_anterior_id != null ? Number(row.evento_anterior_id) : null,
    eventoAnteriorNome: row.evento_anterior_nome || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function migrateEventos(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      edicao SMALLINT UNSIGNED NOT NULL,
      evento_anterior_id INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uq_eventos_edicao (edicao),
      INDEX idx_eventos_anterior (evento_anterior_id),
      CONSTRAINT fk_eventos_anterior FOREIGN KEY (evento_anterior_id) REFERENCES eventos(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [eventoCols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos_espacos' AND COLUMN_NAME = 'evento_id'`,
  );
  if (eventoCols.length === 0) {
    await pool.query(
      'ALTER TABLE grupos_espacos ADD COLUMN evento_id INT UNSIGNED NULL AFTER id',
    );
  }

  const [arrCols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao' AND COLUMN_NAME = 'evento_id'`,
  );
  if (arrCols.length === 0) {
    await pool.query(
      'ALTER TABLE arrecadacao ADD COLUMN evento_id INT UNSIGNED NULL AFTER id',
    );
  }

  const [eventos] = await pool.query('SELECT id FROM eventos ORDER BY edicao ASC LIMIT 1');
  let defaultEventoId = eventos[0]?.id;

  if (!defaultEventoId) {
    const year = new Date().getFullYear();
    const [result] = await pool.query(
      `INSERT INTO eventos (nome, edicao, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))`,
      ['Opalapa', year],
    );
    defaultEventoId = result.insertId;
  }

  await pool.query('UPDATE grupos_espacos SET evento_id = ? WHERE evento_id IS NULL', [
    defaultEventoId,
  ]);
  await pool.query('UPDATE arrecadacao SET evento_id = ? WHERE evento_id IS NULL', [
    defaultEventoId,
  ]);

  await pool.query('ALTER TABLE grupos_espacos MODIFY evento_id INT UNSIGNED NOT NULL');
  await pool.query('ALTER TABLE arrecadacao MODIFY evento_id INT UNSIGNED NOT NULL');

  const [indexes] = await pool.query(`SHOW INDEX FROM grupos_espacos WHERE Key_name = 'uq_grupos_slug'`);
  if (indexes.length > 0) {
    await pool.query('ALTER TABLE grupos_espacos DROP INDEX uq_grupos_slug');
  }
  const [newIdx] = await pool.query(
    `SHOW INDEX FROM grupos_espacos WHERE Key_name = 'uq_grupos_evento_slug'`,
  );
  if (newIdx.length === 0) {
    await pool.query(
      'ALTER TABLE grupos_espacos ADD UNIQUE KEY uq_grupos_evento_slug (evento_id, slug)',
    );
  }

  const [fkGrupos] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos_espacos'
       AND CONSTRAINT_NAME = 'fk_grupos_evento'`,
  );
  if (fkGrupos.length === 0) {
    await pool.query(
      `ALTER TABLE grupos_espacos ADD CONSTRAINT fk_grupos_evento
         FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE`,
    );
  }

  const [fkArr] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arrecadacao'
       AND CONSTRAINT_NAME = 'fk_arrecadacao_evento'`,
  );
  if (fkArr.length === 0) {
    await pool.query(
      `ALTER TABLE arrecadacao ADD CONSTRAINT fk_arrecadacao_evento
         FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE`,
    );
  }
}

export function createRequireEvento(pool) {
  return async function requireEvento(req, res, next) {
    try {
      const eventoId = parseEventoId(req.headers['x-evento-id']);
      const evento = await findEventoById(pool, eventoId);
      if (!evento) return res.status(404).json({ error: 'Evento não encontrado' });
      req.eventoId = eventoId;
      req.evento = evento;
      next();
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

export function parseEventoId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw Object.assign(new Error('Evento inválido'), { status: 400 });
  }
  return id;
}

export async function listEventos(pool) {
  const [rows] = await pool.query(
    `SELECT e.id, e.nome, e.edicao, e.evento_anterior_id, e.created_at, e.updated_at,
            a.nome AS evento_anterior_nome
     FROM eventos e
     LEFT JOIN eventos a ON a.id = e.evento_anterior_id
     ORDER BY e.edicao DESC, e.nome`,
  );
  return rows.map(rowToEvento);
}

export async function findEventoById(pool, id) {
  const [rows] = await pool.query(
    `SELECT e.id, e.nome, e.edicao, e.evento_anterior_id, e.created_at, e.updated_at,
            a.nome AS evento_anterior_nome
     FROM eventos e
     LEFT JOIN eventos a ON a.id = e.evento_anterior_id
     WHERE e.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToEvento(rows[0]) : null;
}

function normalizeEventoInput(body) {
  const nome = String(body?.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Nome do evento é obrigatório'), { status: 400 });

  const edicao = Number(body?.edicao);
  if (!Number.isInteger(edicao) || edicao < 2000 || edicao > 2100) {
    throw Object.assign(new Error('Informe o ano da edição (ex.: 2026)'), { status: 400 });
  }

  const eventoAnteriorId =
    body?.eventoAnteriorId != null && body.eventoAnteriorId !== ''
      ? Number(body.eventoAnteriorId)
      : null;
  if (eventoAnteriorId != null && (!Number.isInteger(eventoAnteriorId) || eventoAnteriorId < 1)) {
    throw Object.assign(new Error('Edição anterior inválida'), { status: 400 });
  }

  return { nome, edicao, eventoAnteriorId };
}

async function seedEstruturaEvento(pool, eventoId) {
  await ensureGruposForEvento(pool, eventoId);
  await seedEspacosForEvento(pool, eventoId);
}

export async function createEvento(pool, body) {
  const data = normalizeEventoInput(body);
  if (data.eventoAnteriorId) {
    const anterior = await findEventoById(pool, data.eventoAnteriorId);
    if (!anterior) throw Object.assign(new Error('Edição anterior não encontrada'), { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO eventos (nome, edicao, evento_anterior_id, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [data.nome, data.edicao, data.eventoAnteriorId],
    );
    const eventoId = result.insertId;
    await seedEstruturaEvento(conn, eventoId);
    await conn.commit();
    return findEventoById(pool, eventoId);
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('Já existe um evento com esta edição (ano)'), { status: 409 });
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateEvento(pool, id, body) {
  const existing = await findEventoById(pool, id);
  if (!existing) return null;

  const data = normalizeEventoInput(body);
  if (data.eventoAnteriorId === id) {
    throw Object.assign(new Error('O evento não pode referenciar a si mesmo'), { status: 400 });
  }

  try {
    await pool.query(
      `UPDATE eventos SET nome = ?, edicao = ?, evento_anterior_id = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [data.nome, data.edicao, data.eventoAnteriorId, id],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('Já existe um evento com esta edição (ano)'), { status: 409 });
    }
    throw err;
  }

  return findEventoById(pool, id);
}

export async function deleteEvento(pool, id) {
  const [total] = await pool.query('SELECT COUNT(*) AS n FROM eventos');
  if (Number(total[0]?.n || 0) <= 1) {
    throw Object.assign(new Error('Não é possível excluir o único evento cadastrado'), {
      status: 400,
    });
  }
  const [result] = await pool.query('DELETE FROM eventos WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function resumoEvento(pool, eventoId) {
  const [espacos] = await pool.query(
    `SELECT e.status, e.valor, e.sale_group, e.participante_id
     FROM espacos e
     JOIN grupos_espacos g ON g.id = e.grupo_id
     WHERE g.evento_id = ?`,
    [eventoId],
  );

  const status = { disp: 0, lead: 0, neg: 0, res: 0, vend: 0 };
  const active = new Set(['lead', 'neg', 'res', 'vend']);
  const seenGroups = new Set();
  let valorNegociado = 0;
  const participantes = new Set();

  for (const e of espacos) {
    if (status[e.status] != null) status[e.status] += 1;
    if (e.participante_id) participantes.add(e.participante_id);
    if (e.valor == null || !active.has(e.status)) continue;
    if (e.sale_group) {
      const key = `${e.sale_group}:${e.status}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
    }
    valorNegociado += Number(e.valor);
  }

  const [arr] = await pool.query(
    `SELECT valor_total, valor_pago FROM arrecadacao
     WHERE evento_id = ? AND status != 'perda'`,
    [eventoId],
  );
  let arrecadacaoTotal = 0;
  let arrecadacaoPago = 0;
  for (const row of arr) {
    arrecadacaoTotal += Number(row.valor_total);
    arrecadacaoPago += Number(row.valor_pago);
  }

  const totalEspacos = espacos.length;
  const ocupados = status.lead + status.neg + status.res + status.vend;

  return {
    eventoId,
    totalEspacos,
    espacosOcupados: ocupados,
    espacosVendidos: status.vend,
    espacosDisponiveis: status.disp,
    participantes: participantes.size,
    valorNegociado,
    arrecadacaoTotal,
    arrecadacaoPago,
    arrecadacaoFalta: Math.max(0, arrecadacaoTotal - arrecadacaoPago),
    registrosArrecadacao: arr.length,
    status,
  };
}

function delta(atual, anterior) {
  const diff = atual - anterior;
  const pct = anterior !== 0 ? (diff / anterior) * 100 : atual !== 0 ? 100 : 0;
  return { atual, anterior, diff, pct };
}

export async function compararEvento(pool, eventoId) {
  const evento = await findEventoById(pool, eventoId);
  if (!evento) return null;

  const atual = await resumoEvento(pool, eventoId);
  let anterior = null;
  let comparacao = null;

  if (evento.eventoAnteriorId) {
    const eventoAnterior = await findEventoById(pool, evento.eventoAnteriorId);
    if (eventoAnterior) {
      anterior = await resumoEvento(pool, evento.eventoAnteriorId);
      comparacao = {
        valorNegociado: delta(atual.valorNegociado, anterior.valorNegociado),
        arrecadacaoTotal: delta(atual.arrecadacaoTotal, anterior.arrecadacaoTotal),
        arrecadacaoPago: delta(atual.arrecadacaoPago, anterior.arrecadacaoPago),
        espacosOcupados: delta(atual.espacosOcupados, anterior.espacosOcupados),
        espacosVendidos: delta(atual.espacosVendidos, anterior.espacosVendidos),
        participantes: delta(atual.participantes, anterior.participantes),
        registrosArrecadacao: delta(atual.registrosArrecadacao, anterior.registrosArrecadacao),
      };
    }
  }

  return { evento, atual, anterior, comparacao, eventoAnterior: evento.eventoAnteriorId ? await findEventoById(pool, evento.eventoAnteriorId) : null };
}
