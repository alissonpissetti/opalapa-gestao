function formatAgendadoFromDb(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    // Pool usa timezone 'Z': componentes do DATETIME ficam em UTC no Date
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }
  const s = String(value).trim();
  if (!s) return null;
  return s.includes('T') ? s : s.replace(' ', 'T');
}

function rowToTarefa(row) {
  return {
    id: row.id,
    eventoId: Number(row.evento_id),
    participanteId: Number(row.participante_id),
    arrecadacaoId: row.arrecadacao_id != null ? Number(row.arrecadacao_id) : null,
    participanteNome: row.participante_nome || '',
    participanteInstagram: row.participante_instagram || '',
    participanteWhatsapp: row.participante_whatsapp || '',
    arrecadacaoDescricao: row.arrecadacao_descricao || '',
    arrecadacaoTipo: row.arrecadacao_tipo || '',
    agendadoPara: formatAgendadoFromDb(row.agendado_para),
    observacao: row.observacao || '',
    concluida: Boolean(row.concluida),
    concluidaEm: row.concluida_em ? new Date(row.concluida_em).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function parseAgendadoPara(value) {
  const s = String(value || '').trim();
  if (!s) return null;

  let datePart;
  let timePart = '09:00:00';

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    datePart = s;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    datePart = s.slice(0, 10);
    timePart = `${s.slice(11)}:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    datePart = s.slice(0, 10);
    timePart = s.slice(11);
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const [d, t] = s.split(' ');
    datePart = d;
    timePart = t.length === 5 ? `${t}:00` : t;
  } else {
    throw Object.assign(new Error('Data e hora do agendamento inválidas'), { status: 400 });
  }

  const probe = new Date(`${datePart}T${timePart}`);
  if (Number.isNaN(probe.getTime())) {
    throw Object.assign(new Error('Data e hora do agendamento inválidas'), { status: 400 });
  }

  return `${datePart} ${timePart}`;
}

export async function migrateTarefas(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarefas_contato (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      evento_id INT UNSIGNED NOT NULL,
      participante_id INT UNSIGNED NOT NULL,
      arrecadacao_id INT UNSIGNED NULL,
      agendado_para DATETIME NOT NULL,
      observacao TEXT NULL,
      concluida TINYINT(1) NOT NULL DEFAULT 0,
      concluida_em DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NULL,
      INDEX idx_tarefas_evento_agenda (evento_id, agendado_para),
      INDEX idx_tarefas_participante (participante_id),
      INDEX idx_tarefas_arrecadacao (arrecadacao_id),
      CONSTRAINT fk_tarefas_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
      CONSTRAINT fk_tarefas_participante FOREIGN KEY (participante_id) REFERENCES participantes(id) ON DELETE CASCADE,
      CONSTRAINT fk_tarefas_arrecadacao FOREIGN KEY (arrecadacao_id) REFERENCES arrecadacao(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [col] = await pool.query(
    `SELECT DATA_TYPE AS data_type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tarefas_contato' AND COLUMN_NAME = 'agendado_para'`,
  );
  if (col[0]?.data_type === 'date') {
    await pool.query(
      'ALTER TABLE tarefas_contato MODIFY agendado_para DATETIME NOT NULL',
    );
    await pool.query(
      `UPDATE tarefas_contato
       SET agendado_para = CONCAT(DATE(agendado_para), ' 09:00:00')
       WHERE TIME(agendado_para) = '00:00:00'`,
    );
  }
}

export async function createTarefaContato(conn, eventoId, raw) {
  const participanteId = Number(raw.participanteId ?? raw.participante_id);
  const arrecadacaoId =
    raw.arrecadacaoId != null || raw.arrecadacao_id != null
      ? Number(raw.arrecadacaoId ?? raw.arrecadacao_id)
      : null;
  const agendadoPara = parseAgendadoPara(raw.agendadoPara ?? raw.agendado_para ?? raw.proximoContato);
  if (!participanteId) {
    throw Object.assign(new Error('Participante inválido para tarefa de contato'), { status: 400 });
  }
  if (!agendadoPara) {
    throw Object.assign(new Error('Informe data e hora do agendamento'), { status: 400 });
  }

  const observacao = String(raw.observacao ?? raw.obsProximoContato ?? raw.obs_proximo_contato ?? '').trim();

  const [result] = await conn.query(
    `INSERT INTO tarefas_contato
       (evento_id, participante_id, arrecadacao_id, agendado_para, observacao, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [eventoId, participanteId, arrecadacaoId, agendadoPara, observacao || null],
  );

  return findTarefaContatoById(conn, result.insertId);
}

export async function findTarefaContatoById(connOrPool, id) {
  const [rows] = await connOrPool.query(
    `SELECT t.id, t.evento_id, t.participante_id, t.arrecadacao_id, t.agendado_para, t.observacao,
            t.concluida, t.concluida_em, t.created_at,
            p.nome AS participante_nome, p.instagram AS participante_instagram,
            p.contato_telefone AS participante_whatsapp,
            a.descricao AS arrecadacao_descricao, a.tipo AS arrecadacao_tipo
     FROM tarefas_contato t
     JOIN participantes p ON p.id = t.participante_id
     LEFT JOIN arrecadacao a ON a.id = t.arrecadacao_id
     WHERE t.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToTarefa(rows[0]) : null;
}

const TAREFA_SELECT = `
  SELECT t.id, t.evento_id, t.participante_id, t.arrecadacao_id, t.agendado_para, t.observacao,
         t.concluida, t.concluida_em, t.created_at,
         p.nome AS participante_nome, p.instagram AS participante_instagram,
         p.contato_telefone AS participante_whatsapp,
         a.descricao AS arrecadacao_descricao, a.tipo AS arrecadacao_tipo
  FROM tarefas_contato t
  JOIN participantes p ON p.id = t.participante_id
  LEFT JOIN arrecadacao a ON a.id = t.arrecadacao_id`;

export async function listTarefasContato(pool, eventoId, { status = 'pendentes' } = {}) {
  const params = [eventoId];
  let where = 'WHERE t.evento_id = ?';
  if (status === 'pendentes') where += ' AND t.concluida = 0';
  else if (status === 'concluidas') where += ' AND t.concluida = 1';

  const order =
    status === 'concluidas'
      ? 'ORDER BY t.concluida_em DESC, t.id DESC'
      : 'ORDER BY t.agendado_para ASC, t.id ASC';

  const [rows] = await pool.query(`${TAREFA_SELECT} ${where} ${order}`, params);
  return rows.map(rowToTarefa);
}

export async function listTarefasContatoPendentes(pool, eventoId) {
  return listTarefasContato(pool, eventoId, { status: 'pendentes' });
}

export async function listTarefasContatoByArrecadacao(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `${TAREFA_SELECT}
     WHERE t.arrecadacao_id = ? AND t.concluida = 0
     ORDER BY t.agendado_para ASC, t.id ASC`,
    [arrecadacaoId],
  );
  return rows.map(rowToTarefa);
}

export async function updateTarefaContato(pool, id, raw, eventoId = null) {
  const existing = await findTarefaContatoById(pool, id);
  if (!existing) return null;
  if (eventoId != null && existing.eventoId !== eventoId) return null;
  if (existing.concluida) {
    throw Object.assign(new Error('Não é possível editar tarefa concluída'), { status: 400 });
  }

  const agendadoPara =
    raw.agendadoPara != null || raw.agendado_para != null
      ? parseAgendadoPara(raw.agendadoPara ?? raw.agendado_para)
      : parseAgendadoPara(existing.agendadoPara);
  if (!agendadoPara) {
    throw Object.assign(new Error('Informe data e hora do agendamento'), { status: 400 });
  }

  const observacao =
    raw.observacao !== undefined
      ? String(raw.observacao || '').trim()
      : existing.observacao || '';

  await pool.query(
    `UPDATE tarefas_contato
     SET agendado_para = ?, observacao = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [agendadoPara, observacao || null, id],
  );

  return findTarefaContatoById(pool, id);
}

export async function concluirTarefaContato(pool, id, eventoId = null) {
  const params = [id];
  let eventoClause = '';
  if (eventoId != null) {
    eventoClause = ' AND evento_id = ?';
    params.push(eventoId);
  }
  const [result] = await pool.query(
    `UPDATE tarefas_contato
     SET concluida = 1, concluida_em = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND concluida = 0${eventoClause}`,
    params,
  );
  if (result.affectedRows === 0) return null;
  return findTarefaContatoById(pool, id);
}
